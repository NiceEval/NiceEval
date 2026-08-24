import { Either, Schema, Stream } from "effect";
import type { RecordBytesContentHandle } from "../../record/attachment/content.ts";
import type {
  AttachedRecordContent,
  RecordAttachmentSessionBuilder,
} from "../../record/writer/current-attachment.ts";
import type {
  AssertionSourceAnchor,
  AssertionSourceSite,
  AssertionsAttachment,
} from "../../record/family/assertions/definition.ts";
import { assertionsRecordAttachment } from "../../record/family/assertions/definition.ts";
import { sourcesRecordAttachment } from "../../record/family/sources/definition.ts";
import type {
  Sha256Digest,
  SourceItemId,
} from "../../record/model/identifiers.ts";
import type {
  AssertionCoverage,
  AssertionCriterion,
  AssertionLimitation,
  AssertionMaterial,
  AssertionResult,
  AssertionSnapshotObject,
  AssertionSnapshotValue,
  SealedAssertionEntry,
} from "../api.ts";
import {
  AssertionEntryIdSchema,
  AssertionsExactParseOptions,
  BoundedJsonObjectSchema,
  BoundedJsonValueSchema,
  MAX_ASSERTION_DOCUMENT_BYTES,
  createAssertionsRecordSchemas,
  isBoundedJsonObject,
  projectAssertionsDocument,
  type ThirdPartyCriterionRegistry,
} from "./codec.ts";
import {
  createAssertionsDocumentBuilder,
  type AssertionEntryInput,
  type AssertionsDocumentBuilder,
  type AssertionsEntryIdSource,
  type AssertionsProducerError,
} from "./producer.ts";
import type {
  AssertionEntryId,
  AssertionFactValue,
  AssertionEntry,
  AssertionEntryOuter,
  AssertionMaterial as RecordAssertionMaterial,
  AssertionsProjection,
  BoundedJsonObject,
  BoundedJsonValue,
  SealedAssertionResult,
  WritableCriterionEnvelope,
} from "./model.ts";

/**
 * Producer preflight uses a data-only placeholder. The session callback later
 * replaces it with a sealed content handle minted for this Attachment.
 */
interface AssertionsProvisionalContent {
  readonly kind: "assertions-provisional-content";
}

const AssertionsProvisionalContentSchema: Schema.Schema<
  AssertionsProvisionalContent
> = Schema.Struct({
  kind: Schema.Literal("assertions-provisional-content"),
});

const AssertionsProvisionalMaterialSchema: Schema.Schema<
  RecordAssertionMaterial<AssertionsProvisionalContent>
> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("content"),
    content: AssertionsProvisionalContentSchema,
    encoding: Schema.Literal("json", "utf-8", "binary"),
    byteLength: Schema.JsonNumber.pipe(
      Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
    ),
    preview: Schema.NullOr(Schema.String.pipe(
      Schema.filter((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024),
    )),
  }),
);

const assertionsProducerSchemas = createAssertionsRecordSchemas(
  AssertionsProvisionalMaterialSchema,
);

export type AssertionMaterialInput<E, R> =
  | {
      readonly kind: "unavailable";
      readonly reason: "not-recorded";
    }
  | {
      readonly kind: "content";
      readonly source: Stream.Stream<Uint8Array, E, R>;
      readonly encoding: "json" | "utf-8" | "binary";
      readonly byteLength: number;
      readonly preview: string | null;
    };

export interface AssertionsAttachmentEntryInput<E, R> {
  readonly display: AssertionEntryInput<AssertionsProvisionalContent>["display"];
  readonly criterion: AssertionEntryInput<AssertionsProvisionalContent>["criterion"];
  readonly materials: {
    readonly source: AssertionMaterialInput<E, R>;
    readonly evidence: readonly AssertionMaterialInput<E, R>[];
    readonly coverage: AssertionEntryInput<AssertionsProvisionalContent>["materials"]["coverage"];
    readonly limitations: AssertionEntryInput<AssertionsProvisionalContent>["materials"]["limitations"];
  };
  readonly evaluation: AssertionEntryInput<AssertionsProvisionalContent>["evaluation"];
  readonly decision: AssertionEntryInput<AssertionsProvisionalContent>["decision"];
  readonly policy: AssertionEntryInput<AssertionsProvisionalContent>["policy"];
  readonly contribution: AssertionEntryInput<AssertionsProvisionalContent>["contribution"];
  readonly explanationRetention: AssertionEntryInput<AssertionsProvisionalContent>["explanationRetention"];
}

function encodeSnapshotValue(value: AssertionSnapshotValue): BoundedJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(encodeSnapshotValue));
  }
  const encoded: globalThis.Record<string, BoundedJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValue(nested);
  }
  return Object.freeze(encoded);
}

function encodeSnapshotObject(value: AssertionSnapshotObject): BoundedJsonObject {
  const encoded: globalThis.Record<string, BoundedJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValue(nested);
  }
  return Object.freeze(encoded);
}

function explanationValue(value: unknown): AssertionFactValue {
  if (value === null || typeof value === "boolean" || typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))) {
    return Object.freeze({ kind: "value" as const, value });
  }
  if (Array.isArray(value)) {
    return Object.freeze({ kind: "list" as const, items: Object.freeze(value.map(explanationValue)) });
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze({
      kind: "fields" as const,
      fields: Object.freeze(Object.entries(value).map(([label, nested]) => Object.freeze({
        label,
        value: explanationValue(nested),
      }))),
    });
  }
  return Object.freeze({ kind: "unavailable" as const, reason: "source-unavailable" as const });
}

function encodeCriterion(criterion: AssertionCriterion): WritableCriterionEnvelope {
  switch (criterion.kind) {
    case "value-match":
      return Object.freeze({
        kind: "builtin" as const,
        id: "value-match/v1" as const,
        data: Object.freeze({ subject: criterion.subject, matcher: criterion.matcher }),
      });
    case "scope-status":
      return Object.freeze({
        kind: "builtin" as const,
        id: "scope-status/v1" as const,
        data: Object.freeze({ scope: criterion.scope, assertion: criterion.assertion }),
      });
    case "occurrence":
      return Object.freeze({
        kind: "builtin" as const,
        id: "occurrence/v1" as const,
        data: Object.freeze({
          scope: criterion.scope,
          occurrence: criterion.occurrence,
          assertion: criterion.assertion,
          ...(criterion.matcher === undefined ? {} : { matcher: criterion.matcher }),
          ...(criterion.quantifier === undefined
            ? {}
            : {
                quantifier: criterion.quantifier.kind === "absent"
                  ? Object.freeze({ kind: "absent" as const })
                  : Object.freeze({ kind: criterion.quantifier.kind, count: criterion.quantifier.count }),
              }),
        }),
      });
    case "judge-measurement":
      return Object.freeze({
        kind: "builtin" as const,
        id: "judge-measurement/v1" as const,
        data: Object.freeze({ recipe: criterion.recipe, scale: criterion.scale }),
      });
    case "sandbox-result": {
      switch (criterion.operation) {
        case "changed-paths":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "changed-paths" as const, paths: Object.freeze([...criterion.paths]) }),
          });
        case "no-changes":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "no-changes" as const }),
          });
        case "file-changed":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({
              operation: "file-changed" as const,
              path: criterion.path,
              ...(criterion.status === undefined ? {} : { status: criterion.status }),
              ...(criterion.before === undefined ? {} : { before: criterion.before }),
              ...(criterion.after === undefined ? {} : { after: criterion.after }),
            }),
          });
        case "file-deleted":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({ operation: "file-deleted" as const, path: criterion.path }),
          });
        case "not-in-diff":
          return Object.freeze({
            kind: "builtin" as const,
            id: "sandbox-result/v1" as const,
            data: Object.freeze({
              operation: "not-in-diff" as const,
              pattern: criterion.pattern,
              flags: criterion.flags,
              content: criterion.content,
            }),
          });
      }
    }
    case "direct-score":
      return Object.freeze({
        kind: "builtin" as const,
        id: "direct-score/v1" as const,
        data: Object.freeze({ source: criterion.source }),
      });
    case "third-party":
      return Object.freeze({
        name: criterion.name,
        schemaId: criterion.schemaId,
        data: encodeSnapshotValue(criterion.data),
      });
  }
}

function encodeMaterial(
  material: AssertionMaterial,
): AssertionMaterialInput<never, never> {
  switch (material.kind) {
    case "snapshot": {
      const value = encodeSnapshotValue(material.value);
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const validated = Schema.decodeUnknownEither(
        BoundedJsonValueSchema,
        AssertionsExactParseOptions,
      )(value);
      if (Either.isLeft(validated)) {
        throw new Error("Assertions snapshot is outside the bounded JSON contract");
      }
      return Object.freeze({
        kind: "content" as const,
        source: Stream.succeed(bytes),
        encoding: "json" as const,
        byteLength: bytes.byteLength,
        preview: null,
      });
    }
    case "record-attachment": {
      const bytes = new TextEncoder().encode(JSON.stringify({
        kind: "file-changes",
        preview: material.preview,
      }));
      return Object.freeze({
        // Keep only the already-safe display fact. The source Attachment
        // capability never crosses into the Assertions closure.
        kind: "content" as const,
        source: Stream.succeed(bytes),
        encoding: "json" as const,
        byteLength: bytes.byteLength,
        preview: material.preview,
      });
    }
  }
}

function encodeCoverage(coverage: AssertionCoverage): AssertionCoverage {
  switch (coverage.state) {
    case "complete":
      return Object.freeze({ state: "complete" as const });
    case "partial":
      return Object.freeze({ state: "partial" as const, reason: coverage.reason });
    case "unavailable":
      return Object.freeze({ state: "unavailable" as const, reason: coverage.reason });
    case "not-applicable":
      return Object.freeze({ state: "not-applicable" as const, reason: coverage.reason });
  }
}

function encodeLimitations(
  limitations: readonly AssertionLimitation[],
): readonly AssertionLimitation[] {
  return Object.freeze(limitations.map((limitation): AssertionLimitation => {
    switch (limitation.kind) {
      case "redacted":
        return Object.freeze({ kind: "redacted" as const, fieldCount: limitation.fieldCount });
      case "sampled":
        return Object.freeze({
          kind: "sampled" as const,
          captured: limitation.captured,
          ...(limitation.knownTotal === undefined ? {} : { knownTotal: limitation.knownTotal }),
        });
      case "truncated":
        return Object.freeze({ kind: "truncated" as const, omittedBytes: limitation.omittedBytes });
      case "provider-limited":
        return Object.freeze({ kind: "provider-limited" as const });
    }
  }));
}

export function encodeAssertionResult(result: AssertionResult): SealedAssertionResult {
  const diagnostic = result.diagnostic === undefined
    ? {}
    : { diagnostic: encodeSnapshotObject(result.diagnostic) };
  const receipt = result.receipt === undefined ? {} : { receipt: Object.freeze({ ...result.receipt }) };
  switch (result.state) {
    case "matched":
      return Object.freeze({
        state: "matched" as const,
        gate: result.gate,
        score: result.score.state === "earned"
          ? Object.freeze({ state: "earned" as const, points: result.score.points, earned: result.score.earned })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
        ...receipt,
      });
    case "mismatched":
      return Object.freeze({
        state: "mismatched" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "earned"
          ? Object.freeze({ state: "earned" as const, points: result.score.points, earned: result.score.earned })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
        ...receipt,
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
        ...receipt,
      });
    case "errored":
      return Object.freeze({
        state: "errored" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
        ...receipt,
      });
    case "not-applicable":
      return Object.freeze({
        state: "not-applicable" as const,
        reason: result.reason,
        gate: result.gate,
        score: result.score.state === "unavailable"
          ? Object.freeze({ state: "unavailable" as const, points: result.score.points, reason: result.score.reason })
          : Object.freeze({ state: "not-scored" as const }),
        ...diagnostic,
        ...receipt,
      });
  }
}

/** Private Runtime → durable Assertions codec bridge. */
export function encodeSealedAssertionEntry(
  entry: SealedAssertionEntry,
): AssertionsAttachmentEntryInput<never, never> {
  const criterion = encodeCriterion(entry.criterion);
  const subject = encodeMaterial(entry.subject);
  const result = encodeAssertionResult(entry.result);
  return Object.freeze({
    display: Object.freeze({
      ...(entry.display.key === undefined ? {} : { key: entry.display.key }),
      ...(entry.display.label === undefined ? {} : { label: entry.display.label }),
      groupPath: Object.freeze([...entry.display.groupPath]),
    }),
    criterion: Object.freeze({ state: "available" as const, value: criterion }),
    materials: Object.freeze({
      source: subject,
      evidence: Object.freeze(entry.evidence.map(encodeMaterial)),
      coverage: encodeCoverage(entry.coverage),
      limitations: encodeLimitations(entry.limitations),
    }),
    evaluation: Object.freeze({
      observed: explanationValue(entry.observed),
      ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
    }),
    decision: Object.freeze({
      result: result.state,
      reason: "reason" in result ? result.reason : null,
      gate: result.gate,
    }),
    policy: Object.freeze({
      requirement: Object.freeze({ state: "available" as const, value: entry.policy.requirement }),
      condition: Object.freeze({ state: "available" as const, value: entry.policy.condition }),
    }),
    contribution: result.score,
    explanationRetention: result.diagnostic === undefined
      ? Object.freeze({ state: "retained" as const, value: Object.freeze({
          kind: "unavailable" as const,
          reason: "not-declared" as const,
        }) })
      : Object.freeze({ state: "retained" as const, value: explanationValue(result.diagnostic) }),
  });
}

export interface AssertionSourceSiteInput {
  readonly entryId: AssertionEntryId;
  readonly sourceOrder: number;
  readonly role: AssertionSourceSite["role"];
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourceSite["start"];
  readonly end: AssertionSourceSite["end"];
}

export interface AssertionsAttachmentSealInput {
  /** Semantic joins to origin-Run Sources, embedded in this fixed family. */
  readonly sourceSites?: readonly AssertionSourceSiteInput[];
}

type AssertionsAttachedContent<E, R> = AttachedRecordContent<
  RecordBytesContentHandle,
  E,
  R
>;

export interface AssertionsAttachmentDraft<E, R> {
  readonly entries: readonly AssertionEntryOuter<AssertionsAttachedContent<E, R>>[];
  readonly sourceSites: readonly AssertionSourceSite[];
}

export type AssertionsAttachmentCapture<E, R> = (
  build: RecordAttachmentSessionBuilder,
) => AssertionsAttachmentDraft<E, R>;

export interface AssertionsAttachmentProducer<E, R> {
  readonly append: (
    entry: AssertionsAttachmentEntryInput<E, R>,
  ) => Either.Either<AssertionEntryId, AssertionsProducerError>;
  readonly seal: (input?: AssertionsAttachmentSealInput) => Either.Either<
    AssertionsAttachmentCapture<E, R>,
    AssertionsProducerError
  >;
}

function makeProvisionalContent(): AssertionsProvisionalContent {
  return Object.freeze({ kind: "assertions-provisional-content" });
}

function provisionalMaterial<E, R>(
  material: AssertionMaterialInput<E, R>,
): RecordAssertionMaterial<AssertionsProvisionalContent> {
  return material.kind === "unavailable"
    ? material
    : Object.freeze({
        kind: "content" as const,
        content: makeProvisionalContent(),
        encoding: material.encoding,
        byteLength: material.byteLength,
        preview: material.preview,
      });
}

function provisionalEntry<E, R>(
  entry: AssertionsAttachmentEntryInput<E, R>,
): AssertionEntryInput<AssertionsProvisionalContent> {
  return Object.freeze({
    display: entry.display,
    criterion: entry.criterion,
    materials: Object.freeze({
      source: provisionalMaterial(entry.materials.source),
      evidence: Object.freeze(entry.materials.evidence.map(provisionalMaterial)),
      coverage: entry.materials.coverage,
      limitations: entry.materials.limitations,
    }),
    evaluation: entry.evaluation,
    decision: entry.decision,
    policy: entry.policy,
    contribution: entry.contribution,
    explanationRetention: entry.explanationRetention,
  });
}

interface AssertionsAttachmentEntrySources<E, R> {
  readonly source: AssertionMaterialInput<E, R>;
  readonly evidence: readonly AssertionMaterialInput<E, R>[];
}

function captureEntrySources<E, R>(
  entry: AssertionsAttachmentEntryInput<E, R>,
): AssertionsAttachmentEntrySources<E, R> {
  return Object.freeze({
    source: entry.materials.source,
    evidence: Object.freeze([...entry.materials.evidence]),
  });
}

function materializeMaterial<E, R>(
  material: RecordAssertionMaterial<AssertionsProvisionalContent>,
  source: AssertionMaterialInput<E, R>,
  build: RecordAttachmentSessionBuilder,
): RecordAssertionMaterial<AssertionsAttachedContent<E, R>> {
  if (material.kind === "unavailable") {
    if (source.kind !== "unavailable") {
      throw new Error("Assertions producer changed a sealed material kind");
    }
    return material;
  }
  if (source.kind !== "content") {
    throw new Error("Assertions producer changed a sealed material kind");
  }
  return Object.freeze({
    kind: "content",
    content: build.content.stream(source.source),
    encoding: material.encoding,
    byteLength: material.byteLength,
    preview: material.preview,
  });
}

function outerCriterion<Content>(
  criterion: AssertionEntry<AssertionsProvisionalContent>["criterion"],
): AssertionEntryOuter<Content>["criterion"] {
  if (criterion.state === "unavailable") return criterion;
  if (!isBoundedJsonObject(criterion.value)) {
    throw new Error("An Assertions writer criterion must be bounded JSON");
  }
  const decoded = Schema.decodeUnknownEither(
    BoundedJsonObjectSchema,
    AssertionsExactParseOptions,
  )(criterion.value);
  if (Either.isLeft(decoded)) {
    throw new Error("An Assertions writer criterion must be bounded JSON");
  }
  return Object.freeze({ state: "available" as const, value: decoded.right });
}

function materializeDocument<E, R>(
  sources: readonly AssertionsAttachmentEntrySources<E, R>[],
  sealedEntries: readonly AssertionEntry<AssertionsProvisionalContent>[],
  sourceSites: readonly AssertionSourceSiteInput[],
  build: RecordAttachmentSessionBuilder,
): AssertionsAttachmentDraft<E, R> {
  const entries: AssertionEntryOuter<AssertionsAttachedContent<E, R>>[] = [];
  for (const [index, sealed] of sealedEntries.entries()) {
    const captured = sources[index];
    if (captured === undefined) {
      throw new Error("Assertions producer lost a sealed entry source");
    }
    if (captured.evidence.length !== sealed.materials.evidence.length) {
      throw new Error("Assertions producer changed sealed evidence cardinality");
    }
    entries.push(Object.freeze({
      entryId: sealed.entryId,
      display: sealed.display,
      criterion: outerCriterion(sealed.criterion),
      materials: Object.freeze({
        source: materializeMaterial(sealed.materials.source, captured.source, build),
        evidence: Object.freeze(
          sealed.materials.evidence.map((material, evidenceIndex) => {
            const evidenceSource = captured.evidence[evidenceIndex];
            if (evidenceSource === undefined) {
              throw new Error("Assertions producer lost a sealed evidence source");
            }
            return materializeMaterial(material, evidenceSource, build);
          }),
        ),
        coverage: sealed.materials.coverage,
        limitations: sealed.materials.limitations,
      }),
      evaluation: sealed.evaluation,
      decision: sealed.decision,
      policy: sealed.policy,
      contribution: sealed.contribution,
      explanationRetention: sealed.explanationRetention,
    }));
  }

  const sites = sourceSites.map((site): AssertionSourceSite => {
    const anchor: AssertionSourceAnchor = Object.freeze({
      sourceItemId: site.sourceItemId,
      sha256: site.sha256,
    });
    return Object.freeze({
      entryId: site.entryId,
      sourceOrder: site.sourceOrder,
      role: site.role,
      source: build.reference.to(sourcesRecordAttachment, anchor),
      start: site.start,
      end: site.end,
    });
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    sourceSites: Object.freeze(sites),
  });
}

/** Collects facts, then returns the exact session callback that mints closure tokens. */
export function createAssertionsAttachmentProducer<E, R>(config: {
  readonly entryIds: AssertionsEntryIdSource;
}): AssertionsAttachmentProducer<E, R> {
  const documentBuilder: AssertionsDocumentBuilder<AssertionsProvisionalContent> =
    createAssertionsDocumentBuilder({
      documentSchema: assertionsProducerSchemas.document,
      entryIds: config.entryIds,
    });
  const sources: AssertionsAttachmentEntrySources<E, R>[] = [];
  let sealed:
    | Either.Either<AssertionsAttachmentCapture<E, R>, AssertionsProducerError>
    | undefined;

  const producer: AssertionsAttachmentProducer<E, R> = {
    append(entry) {
      const appended = documentBuilder.append(provisionalEntry(entry));
      if (Either.isRight(appended)) sources.push(captureEntrySources(entry));
      return appended;
    },
    seal(sealInput: AssertionsAttachmentSealInput = {}) {
      if (sealed !== undefined) return sealed;
      const sourceSites = Object.freeze([...(sealInput.sourceSites ?? [])]);
      const sourceSiteWireShape = sourceSites.map((site) => Object.freeze({
        entryId: site.entryId,
        sourceOrder: site.sourceOrder,
        role: site.role,
        source: Object.freeze({
          value: Object.freeze({
            sourceItemId: site.sourceItemId,
            sha256: site.sha256,
          }),
        }),
        start: site.start,
        end: site.end,
      }));
      const emptyEntriesBytes = new TextEncoder().encode(JSON.stringify({ entries: [] })).byteLength;
      const sourceSitesFramingBytes = new TextEncoder().encode(JSON.stringify({
        entries: [],
        sourceSites: sourceSiteWireShape,
      })).byteLength - emptyEntriesBytes;
      const document = documentBuilder.seal({
        maximumBytes: MAX_ASSERTION_DOCUMENT_BYTES - sourceSitesFramingBytes,
      });
      if (Either.isLeft(document)) {
        sealed = Either.left(document.left);
        return sealed;
      }
      sealed = Either.right((build) => materializeDocument(
        sources,
        document.right.entries,
        sourceSites,
        build,
      ));
      return sealed;
    },
  };
  return Object.freeze(producer);
}

export interface AssertionsProjectorDefinition {
  readonly definition: typeof assertionsRecordAttachment;
  readonly project: (
    value: AssertionsAttachment,
  ) => AssertionsProjection<RecordBytesContentHandle>;
}

/** Typed, synchronous projection over one already-validated logical value. */
export function defineAssertionsProjector(
  registry: ThirdPartyCriterionRegistry,
): AssertionsProjectorDefinition {
  return Object.freeze({
    definition: assertionsRecordAttachment,
    project(value: AssertionsAttachment) {
      return projectAssertionsDocument(value, registry);
    },
  });
}
