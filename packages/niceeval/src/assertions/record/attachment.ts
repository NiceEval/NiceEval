import { Result, Schema, Stream } from "effect";
import { omitUndefined } from "../../shared/omit-undefined.ts";
import { readJudgeImage } from "../../judge/image.ts";
import { fullAssertionContentOf } from "../full-content.ts";
import { encodeAssertionSnapshotJson } from "../snapshot-json.ts";
import type { RecordBytesContentHandle } from "../../record/attachment/content.ts";
import type { AttachedRecordContent, RecordAttachmentSessionBuilder } from "../../record/writer/current-attachment.ts";
import type {
  AssertionSourceAnchor,
  AssertionSourceSite,
  AssertionsAttachment,
} from "../../record/family/assertions/definition.ts";
import { assertionsRecordAttachment } from "../../record/family/assertions/definition.ts";
import { sourcesRecordAttachment } from "../../record/family/sources/definition.ts";
import type { Sha256Digest, SourceItemId } from "../../record/model/identifiers.ts";
import type {
  AssertionCoverage,
  AssertionCriterion,
  AssertionLimitation,
  AssertionMaterial,
  AssertionResult,
  AssertionSnapshotObject,
  AssertionSnapshotValue,
  MatcherQueryArtifact as RuntimeMatcherQueryArtifact,
  SealedAssertionEntry,
} from "../api.ts";
import {
  AssertionsExactParseOptions,
  BoundedJsonObjectSchema,
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
  AssertionLimitation as RecordAssertionLimitation,
  MatcherQueryArtifact as RecordMatcherQueryArtifact,
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

const AssertionsProvisionalContentSchema: Schema.Schema<AssertionsProvisionalContent> = Schema.Struct({
  kind: Schema.Literal("assertions-provisional-content"),
});

const AssertionsProvisionalMaterialSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("content"),
    content: Schema.toType(AssertionsProvisionalContentSchema),
    encoding: Schema.Literals(["json", "utf-8", "binary"]),
    byteLength: Schema.Finite.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
    preview: Schema.NullOr(
      Schema.String.check(Schema.makeFilter((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024)),
    ),
  }),
]);

const assertionsProducerSchemas = createAssertionsRecordSchemas(AssertionsProvisionalMaterialSchema);

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
  readonly evaluatorFailure?: NonNullable<AssertionEntryInput<AssertionsProvisionalContent>["evaluatorFailure"]>;
  readonly policy: AssertionEntryInput<AssertionsProvisionalContent>["policy"];
  readonly control: AssertionEntryInput<AssertionsProvisionalContent>["control"];
  readonly contribution: AssertionEntryInput<AssertionsProvisionalContent>["contribution"];
  readonly explanationRetention: AssertionEntryInput<AssertionsProvisionalContent>["explanationRetention"];
}

function encodeSnapshotValue(value: AssertionSnapshotValue): BoundedJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(encodeSnapshotValue);
  }
  const encoded: globalThis.Record<string, BoundedJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValue(nested);
  }
  return encoded;
}

function encodeSnapshotObject(value: AssertionSnapshotObject): BoundedJsonObject {
  const encoded: globalThis.Record<string, BoundedJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    encoded[key] = encodeSnapshotValue(nested);
  }
  return encoded;
}

function explanationValue(value: unknown): AssertionFactValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return { kind: "value" as const, value };
  }
  if (Array.isArray(value)) {
    return {
      kind: "list" as const,
      items: value.map(explanationValue),
    };
  }
  if (typeof value === "object" && value !== null) {
    return {
      kind: "fields" as const,
      fields: Object.entries(value).map(([label, nested]) => ({
        label,
        value: explanationValue(nested),
      })),
    };
  }
  return { kind: "unavailable" as const, reason: "source-unavailable" as const };
}

function encodeRetainedRows(
  rows: RuntimeMatcherQueryArtifact["retainedRows"],
): RecordMatcherQueryArtifact["retainedRows"] {
  return rows.map((row) => ({
    locator: row.locator,
    result: row.result,
    ...(row.difference === undefined ? {} : { difference: explanationValue(row.difference) }),
  }));
}

function encodeMatcherArtifact(artifact: RuntimeMatcherQueryArtifact): RecordMatcherQueryArtifact {
  if (artifact.kind === "collection-filter") {
    return {
      kind: "collection-filter" as const,
      sourceSnapshot: artifact.sourceSnapshot,
      query: {
        step: artifact.query.step,
        summary: explanationValue(artifact.query.summary),
      },
      receipt: artifact.receipt,
      retainedRows: encodeRetainedRows(artifact.retainedRows),
    };
  }
  const artifactResult = artifact.result;
  function recordedSequenceResult(): Extract<
    RecordMatcherQueryArtifact,
    { readonly kind: "ordered-sequence" }
  >["result"] {
    if (artifactResult.state === "matched")
      return {
        state: "matched" as const,
        witnessPath: artifactResult.witnessPath,
      };
    if (artifactResult.state === "mismatched")
      return {
        state: "mismatched" as const,
        failureFrontier: {
          longestDefinitePrefix: artifactResult.failureFrontier.longestDefinitePrefix,
          longestPossiblePrefix: artifactResult.failureFrontier.longestPossiblePrefix,
          firstBlockingStep: artifactResult.failureFrontier.firstBlockingStep,
          suffixChecked: artifactResult.failureFrontier.suffixChecked,
          representatives: encodeRetainedRows(artifactResult.failureFrontier.representatives),
        },
      };
    return {
      state: "unavailable" as const,
      reason: artifactResult.reason,
    };
  }
  const result = recordedSequenceResult();
  return {
    kind: "ordered-sequence" as const,
    sourceSnapshot: artifact.sourceSnapshot,
    querySteps: artifact.querySteps.map((step) => ({
      step: step.step,
      summary: explanationValue(step.summary),
    })),
    receipt: artifact.receipt,
    result,
    retainedRows: encodeRetainedRows(artifact.retainedRows),
  };
}

function encodeCriterion(criterion: AssertionCriterion): WritableCriterionEnvelope {
  switch (criterion.kind) {
    case "value-match":
      if ("numeric" in criterion) {
        return {
          kind: "builtin" as const,
          id: "numeric-comparison" as const,
          data: {
            comparator: criterion.numeric.comparator,
            threshold: criterion.numeric.threshold,
            ...(criterion.numeric.comparator === "between" ? { upperThreshold: criterion.numeric.upperThreshold } : {}),
            ...(criterion.numeric.unit === undefined ? {} : { unit: criterion.numeric.unit }),
            subject: criterion.numeric.subject,
          },
        };
      }
      return {
        kind: "builtin" as const,
        id: "value-match" as const,
        data: { subject: criterion.subject, matcher: criterion.matcher },
      };
    case "scope-status":
      return {
        kind: "builtin" as const,
        id: "scope-status" as const,
        data: { scope: criterion.scope, assertion: criterion.assertion },
      };
    case "occurrence":
      return {
        kind: "builtin" as const,
        id: "occurrence" as const,
        data: {
          scope: criterion.scope,
          occurrence: criterion.occurrence,
          assertion: criterion.assertion,
          ...(criterion.matcher === undefined ? {} : { matcher: criterion.matcher }),
          ...(criterion.quantifier === undefined
            ? {}
            : {
                quantifier:
                  criterion.quantifier.kind === "absent"
                    ? { kind: "absent" as const }
                    : { kind: criterion.quantifier.kind, count: criterion.quantifier.count },
              }),
        },
      };
    case "judge-measurement":
      return {
        kind: "builtin" as const,
        id: "judge-measurement" as const,
        data: { name: criterion.name, scale: criterion.scale },
      };
    case "managed-score-measurement":
      return {
        kind: "builtin" as const,
        id: "llm-measurement" as const,
        data: { name: criterion.name, scale: criterion.scale },
      };
    case "agent-judge-measurement":
      return {
        kind: "builtin" as const,
        id: "agent-judge-measurement" as const,
        data: { name: criterion.name, scale: criterion.scale },
      };
    case "sandbox-change-scope":
      return {
        kind: "builtin" as const,
        id: "sandbox-change-scope" as const,
        data: omitUndefined({ paths: criterion.paths, window: criterion.window }),
      };
    case "sandbox-unchanged-within":
      return {
        kind: "builtin" as const,
        id: "sandbox-unchanged-within" as const,
        data: omitUndefined({ paths: criterion.paths, window: criterion.window }),
      };
    case "sandbox-diff-paths":
      return {
        kind: "builtin" as const,
        id: "sandbox-diff-paths" as const,
        data: omitUndefined({
          operation: criterion.operation,
          pattern: criterion.pattern,
          flags: criterion.flags,
          window: criterion.window,
        }),
      };
    case "sandbox-in-diff":
      return {
        kind: "builtin" as const,
        id: "sandbox-in-diff" as const,
        data: omitUndefined({
          pattern: criterion.pattern,
          flags: criterion.flags,
          content: criterion.content,
          window: criterion.window,
        }),
      };
    case "sandbox-result": {
      switch (criterion.operation) {
        case "changed-paths":
          return {
            kind: "builtin" as const,
            id: "sandbox-result" as const,
            data: omitUndefined({
              operation: "changed-paths" as const,
              paths: criterion.paths,
              window: criterion.window,
            }),
          };
        case "no-changes":
          return {
            kind: "builtin" as const,
            id: "sandbox-result" as const,
            data: omitUndefined({ operation: "no-changes" as const, window: criterion.window }),
          };
        case "file-changed":
          return {
            kind: "builtin" as const,
            id: "sandbox-result" as const,
            data: omitUndefined({
              operation: "file-changed" as const,
              path: criterion.path,
              status: criterion.status,
              before: criterion.before,
              after: criterion.after,
              window: criterion.window,
            }),
          };
        case "file-deleted":
          return {
            kind: "builtin" as const,
            id: "sandbox-result" as const,
            data: omitUndefined({ operation: "file-deleted" as const, path: criterion.path, window: criterion.window }),
          };
        case "not-in-diff":
          return {
            kind: "builtin" as const,
            id: "sandbox-result" as const,
            data: omitUndefined({
              operation: "not-in-diff" as const,
              pattern: criterion.pattern,
              flags: criterion.flags,
              content: criterion.content,
              window: criterion.window,
            }),
          };
      }
    }
    case "direct-score":
      return {
        kind: "builtin" as const,
        id: "direct-score" as const,
        data: { source: criterion.source },
      };
    case "third-party":
      return {
        name: criterion.name,
        schemaId: criterion.schemaId,
        data: encodeSnapshotValue(criterion.data),
      };
  }
}

function encodeMaterial(material: AssertionMaterial): AssertionMaterialInput<never, never> {
  switch (material.kind) {
    case "judge-image": {
      const body = readJudgeImage(material.image).body;
      return {
        kind: "content" as const,
        source: Stream.succeed(body),
        encoding: "binary" as const,
        byteLength: body.byteLength,
        preview: null,
      };
    }
    case "snapshot": {
      const content = fullAssertionContentOf(material) ?? encodeAssertionSnapshotJson(material.value);
      const bytes = new TextEncoder().encode(content);
      return {
        kind: "content" as const,
        source: Stream.succeed(bytes),
        encoding: "json" as const,
        byteLength: bytes.byteLength,
        preview: null,
      };
    }
    case "record-attachment": {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          kind: "file-changes",
          preview: material.preview,
        }),
      );
      return {
        // Keep only the already-safe display fact. The source Attachment
        // capability never crosses into the Assertions closure.
        kind: "content" as const,
        source: Stream.succeed(bytes),
        encoding: "json" as const,
        byteLength: bytes.byteLength,
        preview: material.preview,
      };
    }
  }
}

function encodeCoverage(coverage: AssertionCoverage): AssertionCoverage {
  switch (coverage.state) {
    case "complete":
      return { state: "complete" as const };
    case "partial":
      return { state: "partial" as const, reason: coverage.reason };
    case "unavailable":
      return { state: "unavailable" as const, reason: coverage.reason };
    case "not-applicable":
      return { state: "not-applicable" as const, reason: coverage.reason };
  }
}

function encodeLimitations(limitations: readonly AssertionLimitation[]): readonly RecordAssertionLimitation[] {
  return limitations.map((limitation): RecordAssertionLimitation => {
    switch (limitation.kind) {
      case "redacted":
        return { kind: "redacted" as const, fieldCount: limitation.fieldCount };
      case "sampled":
        return {
          kind: "sampled" as const,
          captured: limitation.captured,
          ...(limitation.knownTotal === undefined ? {} : { knownTotal: limitation.knownTotal }),
        };
      case "truncated":
        return { kind: "truncated" as const, omittedBytes: limitation.omittedBytes };
      case "provider-limited":
        return { kind: "provider-limited" as const };
      case "capacity-limited":
        return limitation;
    }
  });
}

export function encodeAssertionResult(result: AssertionResult): SealedAssertionResult {
  const diagnostic = result.diagnostic === undefined ? {} : { diagnostic: encodeSnapshotObject(result.diagnostic) };
  const receipt = result.receipt === undefined ? {} : { receipt: result.receipt };
  switch (result.state) {
    case "matched":
      return {
        state: "matched" as const,
        gate: result.gate,
        score:
          result.score.state === "earned"
            ? { state: "earned" as const, points: result.score.points, earned: result.score.earned }
            : { state: "not-scored" as const },
        ...diagnostic,
        ...receipt,
      };
    case "mismatched":
      return {
        state: "mismatched" as const,
        reason: result.reason,
        gate: result.gate,
        score:
          result.score.state === "earned"
            ? { state: "earned" as const, points: result.score.points, earned: result.score.earned }
            : { state: "not-scored" as const },
        ...diagnostic,
        ...receipt,
      };
    case "unavailable":
      return {
        state: "unavailable" as const,
        reason: result.reason,
        gate: result.gate,
        score:
          result.score.state === "unavailable"
            ? { state: "unavailable" as const, points: result.score.points, reason: result.score.reason }
            : { state: "not-scored" as const },
        ...diagnostic,
        ...receipt,
      };
    case "errored":
      return {
        state: "errored" as const,
        reason: result.reason,
        gate: result.gate,
        score:
          result.score.state === "unavailable"
            ? { state: "unavailable" as const, points: result.score.points, reason: result.score.reason }
            : { state: "not-scored" as const },
        ...diagnostic,
        ...receipt,
      };
    case "not-applicable":
      return {
        state: "not-applicable" as const,
        reason: result.reason,
        gate: result.gate,
        score:
          result.score.state === "unavailable"
            ? { state: "unavailable" as const, points: result.score.points, reason: result.score.reason }
            : { state: "not-scored" as const },
        ...diagnostic,
        ...receipt,
      };
  }
}

/** Private Runtime → durable Assertions codec bridge. */
export function encodeSealedAssertionEntry(entry: SealedAssertionEntry): AssertionsAttachmentEntryInput<never, never> {
  const criterion = encodeCriterion(entry.criterion);
  const subject = encodeMaterial(entry.subject);
  const result = encodeAssertionResult(entry.result);
  function explanationRetention(): AssertionsAttachmentEntryInput<never, never>["explanationRetention"] {
    if (entry.matcherArtifact !== undefined) return { state: "unavailable", reason: "not-recorded" };
    if (result.diagnostic === undefined)
      return {
        state: "retained",
        value: { kind: "unavailable", reason: "not-declared" },
      };
    return { state: "retained", value: explanationValue(result.diagnostic) };
  }
  return {
    display: {
      ...(entry.display.label === undefined ? {} : { label: entry.display.label }),
      groupPath: entry.display.groupPath,
    },
    criterion: { state: "available" as const, value: criterion },
    materials: {
      source: subject,
      evidence: entry.evidence.map(encodeMaterial),
      coverage: encodeCoverage(entry.coverage),
      limitations: encodeLimitations(entry.limitations),
    },
    evaluation:
      entry.matcherArtifact === undefined
        ? {
            kind: "ordinary" as const,
            observed: explanationValue(entry.observed),
            ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
          }
        : {
            kind: "matcher-current" as const,
            observed: explanationValue(entry.observed),
            artifact: encodeMatcherArtifact(entry.matcherArtifact),
          },
    decision: {
      result: result.state,
      reason: "reason" in result ? result.reason : null,
      gate: result.gate,
    },
    ...(entry.evaluatorFailure === undefined ? {} : { evaluatorFailure: entry.evaluatorFailure }),
    policy: {
      requirement: { state: "available" as const, value: entry.policy.requirement },
      condition: { state: "available" as const, value: entry.policy.condition },
    },
    control: entry.control,
    contribution: result.score,
    explanationRetention: explanationRetention(),
  };
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
  readonly sourceSites: readonly AssertionSourceSiteInput[];
}

type AssertionsAttachedContent<E, R> = AttachedRecordContent<RecordBytesContentHandle, E, R>;

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
  ) => Result.Result<AssertionEntryId, AssertionsProducerError>;
  readonly seal: (
    input?: AssertionsAttachmentSealInput,
  ) => Result.Result<AssertionsAttachmentCapture<E, R>, AssertionsProducerError>;
}

function makeProvisionalContent(): AssertionsProvisionalContent {
  return { kind: "assertions-provisional-content" };
}

function provisionalMaterial<E, R>(
  material: AssertionMaterialInput<E, R>,
): RecordAssertionMaterial<AssertionsProvisionalContent> {
  return material.kind === "unavailable"
    ? material
    : {
        kind: "content" as const,
        content: makeProvisionalContent(),
        encoding: material.encoding,
        byteLength: material.byteLength,
        preview: material.preview,
      };
}

function provisionalEntry<E, R>(
  entry: AssertionsAttachmentEntryInput<E, R>,
): AssertionEntryInput<AssertionsProvisionalContent> {
  return {
    display: entry.display,
    criterion: entry.criterion,
    materials: {
      source: provisionalMaterial(entry.materials.source),
      evidence: entry.materials.evidence.map(provisionalMaterial),
      coverage: entry.materials.coverage,
      limitations: entry.materials.limitations,
    },
    evaluation: entry.evaluation,
    decision: entry.decision,
    ...(entry.evaluatorFailure === undefined ? {} : { evaluatorFailure: entry.evaluatorFailure }),
    policy: entry.policy,
    control: entry.control,
    contribution: entry.contribution,
    explanationRetention: entry.explanationRetention,
  };
}

interface AssertionsAttachmentEntrySources<E, R> {
  readonly source: AssertionMaterialInput<E, R>;
  readonly evidence: readonly AssertionMaterialInput<E, R>[];
}

function captureEntrySources<E, R>(
  entry: AssertionsAttachmentEntryInput<E, R>,
): AssertionsAttachmentEntrySources<E, R> {
  return {
    source: entry.materials.source,
    evidence: [...entry.materials.evidence],
  };
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
  return {
    kind: "content",
    content: build.content.stream(source.source),
    encoding: material.encoding,
    byteLength: material.byteLength,
    preview: material.preview,
  };
}

function outerCriterion<Content>(
  criterion: AssertionEntry<AssertionsProvisionalContent>["criterion"],
): AssertionEntryOuter<Content>["criterion"] {
  if (criterion.state === "unavailable") return criterion;
  if (!isBoundedJsonObject(criterion.value)) {
    throw new Error("An Assertions writer criterion must be bounded JSON");
  }
  const decoded = Schema.decodeUnknownResult(
    Schema.toType(BoundedJsonObjectSchema),
    AssertionsExactParseOptions,
  )(criterion.value);
  if (Result.isFailure(decoded)) {
    throw new Error("An Assertions writer criterion must be bounded JSON");
  }
  return { state: "available" as const, value: decoded.success };
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
    entries.push({
      entryId: sealed.entryId,
      display: sealed.display,
      criterion: outerCriterion(sealed.criterion),
      materials: {
        source: materializeMaterial(sealed.materials.source, captured.source, build),
        evidence: sealed.materials.evidence.map((material, evidenceIndex) => {
          const evidenceSource = captured.evidence[evidenceIndex];
          if (evidenceSource === undefined) {
            throw new Error("Assertions producer lost a sealed evidence source");
          }
          return materializeMaterial(material, evidenceSource, build);
        }),
        coverage: sealed.materials.coverage,
        limitations: sealed.materials.limitations,
      },
      evaluation: sealed.evaluation,
      decision: sealed.decision,
      ...(sealed.evaluatorFailure === undefined ? {} : { evaluatorFailure: sealed.evaluatorFailure }),
      policy: sealed.policy,
      control: sealed.control,
      contribution: sealed.contribution,
      explanationRetention: sealed.explanationRetention,
    });
  }

  const sites = sourceSites.map((site): AssertionSourceSite => {
    const anchor: AssertionSourceAnchor = {
      sourceItemId: site.sourceItemId,
      sha256: site.sha256,
    };
    return {
      entryId: site.entryId,
      sourceOrder: site.sourceOrder,
      role: site.role,
      source: build.reference.to(sourcesRecordAttachment, anchor),
      start: site.start,
      end: site.end,
    };
  });
  return {
    entries: entries,
    sourceSites: sites,
  };
}

/** Collects facts, then returns the exact session callback that mints closure tokens. */
export function createAssertionsAttachmentProducer<E, R>(config: {
  readonly entryIds: AssertionsEntryIdSource;
}): AssertionsAttachmentProducer<E, R> {
  const documentBuilder: AssertionsDocumentBuilder<AssertionsProvisionalContent> = createAssertionsDocumentBuilder({
    documentSchema: assertionsProducerSchemas.document,
    entryIds: config.entryIds,
  });
  const sources: AssertionsAttachmentEntrySources<E, R>[] = [];
  let sealed: Result.Result<AssertionsAttachmentCapture<E, R>, AssertionsProducerError> | undefined;

  const producer: AssertionsAttachmentProducer<E, R> = {
    append(entry) {
      const appended = documentBuilder.append(provisionalEntry(entry));
      if (Result.isSuccess(appended)) sources.push(captureEntrySources(entry));
      return appended;
    },
    seal(sealInput: AssertionsAttachmentSealInput = { sourceSites: [] }) {
      if (sealed !== undefined) return sealed;
      const sourceSites = [...sealInput.sourceSites];
      const document = documentBuilder.seal();
      if (Result.isFailure(document)) {
        sealed = Result.fail(document.failure);
        return sealed;
      }
      sealed = Result.succeed((build) => materializeDocument(sources, document.success.entries, sourceSites, build));
      return sealed;
    },
  };
  return producer;
}

export interface AssertionsProjectorDefinition {
  readonly definition: typeof assertionsRecordAttachment;
  readonly project: (value: AssertionsAttachment) => AssertionsProjection<RecordBytesContentHandle>;
}

/** Typed, synchronous projection over one already-validated logical value. */
export function defineAssertionsProjector(registry: ThirdPartyCriterionRegistry): AssertionsProjectorDefinition {
  return {
    definition: assertionsRecordAttachment,
    project(value: AssertionsAttachment) {
      return projectAssertionsDocument(value, registry);
    },
  };
}
