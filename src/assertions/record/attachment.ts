import { createHash } from "node:crypto";

import { Either, Schema, Stream } from "effect";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type FixedAttachmentWriteSpec,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentPayloadSnapshot,
  type RecordAttachmentWrite,
  type RecordBlobRef,
  type RecordBlobSource,
} from "../../record/attachment/index.ts";
import { Sha256DigestSchema } from "../../record/codec/identifiers.ts";
import type {
  AssertionSourceSite,
  AssertionsAttachment,
} from "../../record/family/assertions.ts";
import type { Sha256Digest } from "../../record/model/identifiers.ts";
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
  AssertionCoverage as RecordAssertionCoverage,
  AssertionLimitation as RecordAssertionLimitation,
  AssertionMaterial as RecordAssertionMaterial,
  AssertionsDocumentOuter,
  AssertionsProjection,
  BoundedJsonObject,
  BoundedJsonValue,
  SealedAssertionResult,
  WritableCriterionEnvelope,
} from "./model.ts";

/**
 * The Record attachment runtime keeps the real ref authority private. This
 * positional schema only lets the Assertions schema carry a package ref;
 * generic Record closure validation still rejects every ref not minted by the
 * current Attachment builder.
 */
const RecordBlobRefPositionSchema: Schema.Schema<
  RecordBlobRef,
  RecordBlobRef,
  never
> = Schema.declare<RecordBlobRef>(
  (value): value is RecordBlobRef => typeof value === "object" && value !== null,
);

/**
 * Producer preflight needs to validate the strict writer document before the
 * real Attachment builder exists. This is deliberately not a RecordBlobRef:
 * final payloads replace it with a ref minted by `blobs.add` below.
 */
interface AssertionsProvisionalBlobRef {
  readonly kind: "assertions-provisional-blob-ref";
}

const AssertionsProvisionalBlobRefSchema: Schema.Schema<
  AssertionsProvisionalBlobRef
> = Schema.Struct({
  kind: Schema.Literal("assertions-provisional-blob-ref"),
});

export const assertionsRecordSchemas = createAssertionsRecordSchemas(
  RecordBlobRefPositionSchema,
);

const assertionsProducerSchemas = createAssertionsRecordSchemas(
  AssertionsProvisionalBlobRefSchema,
);

/** Complete payload-order projection required by Record's closure validator. */
export function assertionBlobRefs(
  document: AssertionsDocumentOuter<RecordBlobRef>,
): readonly RecordBlobRef[] {
  const refs: RecordBlobRef[] = [];
  const collect = (material: RecordAssertionMaterial<RecordBlobRef>): void => {
    if (material.kind === "blob") refs.push(material.ref);
  };
  for (const entry of document.entries) {
    collect(entry.materials.source);
    for (const material of entry.materials.evidence) collect(material);
  }
  return Object.freeze(refs);
}

export type AssertionMaterialInput<E, R> =
  | {
      readonly kind: "unavailable";
      readonly reason: "not-recorded";
    }
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValue;
    }
  | {
      readonly kind: "blob";
      readonly source: RecordBlobSource<E, R>;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      /** Digest declared by the producer and checked against sealed bytes. */
      readonly sha256: Sha256Digest;
      readonly preview: string;
    };

export interface AssertionsAttachmentEntryInput<E, R> {
  readonly display: AssertionEntryInput<RecordBlobRef>["display"];
  readonly criterion: AssertionEntryInput<RecordBlobRef>["criterion"];
  readonly materials: {
    readonly source: AssertionMaterialInput<E, R>;
    readonly evidence: readonly AssertionMaterialInput<E, R>[];
    readonly coverage: AssertionEntryInput<RecordBlobRef>["materials"]["coverage"];
    readonly limitations: AssertionEntryInput<RecordBlobRef>["materials"]["limitations"];
  };
  readonly evaluation: AssertionEntryInput<RecordBlobRef>["evaluation"];
  readonly decision: AssertionEntryInput<RecordBlobRef>["decision"];
  readonly policy: AssertionEntryInput<RecordBlobRef>["policy"];
  readonly contribution: AssertionEntryInput<RecordBlobRef>["contribution"];
  readonly explanationRetention: AssertionEntryInput<RecordBlobRef>["explanationRetention"];
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
      const inline = Schema.decodeUnknownEither(
        BoundedJsonValueSchema,
        AssertionsExactParseOptions,
      )(value);
      if (bytes.byteLength > 32 * 1_024 || Either.isLeft(inline)) {
        const digest = Schema.decodeUnknownEither(Sha256DigestSchema)(
          createHash("sha256").update(bytes).digest("hex"),
        );
        if (Either.isLeft(digest)) {
          throw new Error("Assertions snapshot produced an invalid SHA-256 digest");
        }
        return Object.freeze({
          kind: "blob" as const,
          source: makeRecordBlobSource(Stream.succeed(bytes)),
          encoding: "utf-8" as const,
          byteLength: bytes.byteLength,
          sha256: digest.right,
          preview: `JSON Assertion material stored as a ${bytes.byteLength}-byte blob`,
        });
      }
      return Object.freeze({
        kind: "snapshot" as const,
        value: inline.right,
      });
    }
    case "record-attachment":
      return Object.freeze({
        // The durable Assertions closure cannot hold a capability into the
        // File Changes family. Keep only the already-safe display material.
        kind: "snapshot" as const,
        value: Object.freeze({
          kind: "file-changes",
          preview: material.preview,
        }),
      });
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

export interface AssertionsAttachmentProducer<E, R> {
  readonly append: (
    entry: AssertionsAttachmentEntryInput<E, R>,
  ) => Either.Either<AssertionEntryId, AssertionsProducerError>;
  readonly seal: (input?: AssertionsAttachmentSealInput) => Either.Either<
    RecordAttachmentWrite<"attempt", E, R>,
    AssertionsProducerError
  >;
}

export interface AssertionsAttachmentSealInput {
  /** Semantic joins to origin-Run Sources, embedded in this fixed family. */
  readonly sourceSites?: readonly AssertionSourceSite[];
}

function makeProvisionalBlobRef(): AssertionsProvisionalBlobRef {
  return Object.freeze({ kind: "assertions-provisional-blob-ref" });
}

function provisionalMaterial<E, R>(
  material: AssertionMaterialInput<E, R>,
): RecordAssertionMaterial<AssertionsProvisionalBlobRef> {
  switch (material.kind) {
    case "unavailable":
      return material;
    case "snapshot":
      return Object.freeze({ kind: "snapshot", value: material.value });
    case "blob":
      return Object.freeze({
        kind: "blob",
        ref: makeProvisionalBlobRef(),
        encoding: material.encoding,
        byteLength: material.byteLength,
        sha256: material.sha256,
        preview: material.preview,
      });
  }
}

function provisionalEntry<E, R>(
  entry: AssertionsAttachmentEntryInput<E, R>,
): AssertionEntryInput<AssertionsProvisionalBlobRef> {
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
  material: RecordAssertionMaterial<AssertionsProvisionalBlobRef>,
  source: AssertionMaterialInput<E, R>,
  blobs: RecordAttachmentBlobBuilder,
  drafts: RecordAttachmentBlobDraft<E, R>[],
): RecordAssertionMaterial<RecordBlobRef> {
  if (material.kind === "unavailable") {
    if (source.kind !== "unavailable") {
      throw new Error("Assertions producer changed a sealed material kind");
    }
    return material;
  }
  if (material.kind === "snapshot") {
    if (source.kind !== "snapshot") {
      throw new Error("Assertions producer changed a sealed material kind");
    }
    return Object.freeze({ kind: "snapshot", value: material.value });
  }
  if (source.kind !== "blob") {
    throw new Error("Assertions producer changed a sealed material kind");
  }
  const draft = blobs.add(source.source);
  drafts.push(draft);
  return Object.freeze({
    kind: "blob",
    ref: draft.ref,
    encoding: material.encoding,
    byteLength: material.byteLength,
    sha256: material.sha256,
    preview: material.preview,
  });
}

function outerCriterion(
  criterion: AssertionEntry<AssertionsProvisionalBlobRef>["criterion"],
): AssertionEntryOuter<RecordBlobRef>["criterion"] {
  if (criterion.state === "unavailable") return criterion;
  // Effect's structural decoder reads fields before a trailing filter. Keep
  // the descriptor-aware raw check in front so accessors are never executed.
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
  sealedEntries: readonly AssertionEntry<AssertionsProvisionalBlobRef>[],
  sourceSites: readonly AssertionSourceSite[],
  blobs: RecordAttachmentBlobBuilder,
): {
  readonly payload: AssertionsAttachment;
  readonly blobs: readonly RecordAttachmentBlobDraft<E, R>[];
} {
  const drafts: RecordAttachmentBlobDraft<E, R>[] = [];
  const materializedEntries: AssertionEntryOuter<RecordBlobRef>[] = [];
  for (const [index, sealed] of sealedEntries.entries()) {
    const source = sources[index];
    if (source === undefined) {
      throw new Error("Assertions producer lost a sealed entry source");
    }
    if (source.evidence.length !== sealed.materials.evidence.length) {
      throw new Error("Assertions producer changed sealed evidence cardinality");
    }
    materializedEntries.push(Object.freeze({
      entryId: sealed.entryId,
      display: sealed.display,
      criterion: outerCriterion(sealed.criterion),
      materials: Object.freeze({
        source: materializeMaterial(sealed.materials.source, source.source, blobs, drafts),
        evidence: Object.freeze(
        sealed.materials.evidence.map((material, evidenceIndex) => {
          const evidenceSource = source.evidence[evidenceIndex];
          if (evidenceSource === undefined) {
            throw new Error("Assertions producer lost a sealed evidence source");
          }
          return materializeMaterial(material, evidenceSource, blobs, drafts);
        })),
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
  return Object.freeze({
    payload: Object.freeze({
      entries: Object.freeze(materializedEntries),
      // Source sites are joined into this fixed family by the runner's source
      // capture before final sealing. A producer with no captured site writes
      // the exact empty sequence instead of another durable family.
      sourceSites: Object.freeze([...sourceSites]),
    }),
    blobs: Object.freeze(drafts),
  });
}

/**
 * Collects completed facts in declaration order, then mints every blob ref
 * inside one generic RecordAttachment write. Callers never receive a raw ref,
 * path, key, or bytes channel, so cross-Attachment closure is impossible.
 */
export function createAssertionsAttachmentProducer<E, R>(config: {
  readonly entryIds: AssertionsEntryIdSource;
  /** Injected by the fixed catalog consumer to avoid a catalog initialization cycle. */
  readonly write: FixedAttachmentWriteSpec<"attempt", AssertionsAttachment>;
}): AssertionsAttachmentProducer<E, R> {
  const documentBuilder: AssertionsDocumentBuilder<AssertionsProvisionalBlobRef> =
    createAssertionsDocumentBuilder({
      documentSchema: assertionsProducerSchemas.document,
      entryIds: config.entryIds,
    });
  const sources: AssertionsAttachmentEntrySources<E, R>[] = [];
  let sealed:
    | Either.Either<RecordAttachmentWrite<"attempt", E, R>, AssertionsProducerError>
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
      const emptyEntriesBytes = new TextEncoder().encode(JSON.stringify({ entries: [] })).byteLength;
      const sourceSitesFramingBytes = new TextEncoder().encode(JSON.stringify({
        entries: [],
        sourceSites,
      })).byteLength - emptyEntriesBytes;
      const document = documentBuilder.seal({
        maximumBytes: MAX_ASSERTION_DOCUMENT_BYTES - sourceSitesFramingBytes,
      });
      if (Either.isLeft(document)) {
        sealed = Either.left(document.left);
        return sealed;
      }
      const write = makeFixedRecordAttachmentWrite(
        config.write,
        (blobs) =>
          materializeDocument(
            sources,
            document.right.entries,
            sourceSites,
            blobs,
          ),
      );
      const closure = validateRecordAttachmentWrite(write);
      if (Either.isLeft(closure)) {
        throw new Error("Assertions producer generated an invalid RecordAttachment closure");
      }
      sealed = Either.right(write);
      return sealed;
    },
  };
  return Object.freeze(producer);
}

export interface AssertionsProjectorDefinition {
  readonly write: FixedAttachmentWriteSpec<"attempt", AssertionsAttachment>;
  readonly project: (
    value: RecordAttachmentPayloadSnapshot<AssertionsAttachment>,
  ) => AssertionsProjection<RecordBlobRef>;
}

/** Typed, synchronous projection over one already-materialized Attachment value. */
export function defineAssertionsProjector(
  registry: ThirdPartyCriterionRegistry,
  write: FixedAttachmentWriteSpec<"attempt", AssertionsAttachment>,
): AssertionsProjectorDefinition {
  return Object.freeze({
    write,
    project(value: RecordAttachmentPayloadSnapshot<AssertionsAttachment>) {
      return projectAssertionsDocument(value, registry);
    },
  });
}
