import { Either, Schema } from "effect";
import { isRecordBlobRef } from "../../record/attachment/blob-ref.ts";
import { Sha256DigestSchema } from "../../record/codec/identifiers.ts";
import { assertionRuntimeLimits } from "../limits.ts";
import {
  ASSERTION_ENTRY_ID_BRAND,
  type AssertionCoverage,
  type AssertionDisplay,
  type AssertionFactValue,
  type AssertionEntryId,
  type AssertionEntryOuter,
  type AssertionEntryRead,
  type AssertionEntry,
  type AssertionLimitation,
  type AssertionMaterial,
  type AssertionsDocumentOuter,
  type AssertionsDocument,
  type AssertionsProjection,
  type BoundedJsonObject,
  type BoundedJsonValue,
  type BuiltInCriterionEnvelope,
  type BuiltInCriterion,
  type CriterionOuterEnvelope,
  type EarnedScoreContribution,
  type NoScoreContribution,
  type SealedAssertionResult,
  type ThirdPartyCriterion,
  type UnavailableScoreContribution,
  type WritableCriterionEnvelope,
} from "./model.ts";

/** Durable document-size limit; unlike runtime capture limits it belongs to this codec. */
export const MAX_ASSERTION_DOCUMENT_BYTES = 4 * 1_024 * 1_024;

/** All contract-owned objects use aggregate failures and exact object fields. */
export const AssertionsExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

const UTF8 = new TextEncoder();
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const ASSERTION_ENTRY_ID = /^ae_[a-z0-9]{20}$/;
const ASCII_IDENTIFIER = /^[\x21-\x7e]+$/;

function utf8ByteLength(value: string): number {
  return UTF8.encode(value).byteLength;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isBoundedString(value: string): boolean {
  return utf8ByteLength(value) <= assertionRuntimeLimits.stringBytes;
}

function isDisplayText(value: string): boolean {
  return (
    !CONTROL_CHARACTER.test(value) &&
    codePointLength(value) <= assertionRuntimeLimits.displayCodePoints
  );
}

function isAsciiIdentifier(value: string): boolean {
  return utf8ByteLength(value) <= 128 && ASCII_IDENTIFIER.test(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPlainJsonObject(value: object): boolean {
  // Fixed Record value canonicalization deliberately creates null-prototype
  // durable objects. They are equivalent JSON records here and must round-trip
  // through the Assertions property schema after a Reader hydration.
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasAtMostObjectKeys(value: object): boolean {
  return Object.keys(value).length <= assertionRuntimeLimits.jsonObjectKeys;
}

function hasAtMostArrayItems<Value>(value: readonly Value[]): boolean {
  return value.length <= assertionRuntimeLimits.jsonArrayItems;
}

function isAssertionEntryId(value: string): boolean {
  return ASSERTION_ENTRY_ID.test(value);
}

function isDocumentWithinSizeLimit(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return (
      typeof serialized === "string" &&
      utf8ByteLength(serialized) <= MAX_ASSERTION_DOCUMENT_BYTES
    );
  } catch {
    return false;
  }
}

function hasUniqueEntryIds(
  document: { readonly entries: readonly { readonly entryId: AssertionEntryId }[] },
): boolean {
  const entryIds = new Set<string>();
  for (const entry of document.entries) {
    if (entryIds.has(entry.entryId)) return false;
    entryIds.add(entry.entryId);
  }
  return true;
}

function hasCoverageConsistentLimitations(
  entry: {
    readonly coverage: AssertionCoverage;
    readonly limitations: readonly AssertionLimitation[];
  },
): boolean {
  const coverage = entry.coverage;
  if (coverage.state === "complete") {
    return entry.limitations.length === 0;
  }
  if (coverage.state !== "partial") return true;
  return entry.limitations.some((limitation) => limitation.kind === coverage.reason);
}

const BoundedJsonStringSchema = Schema.String.pipe(
  Schema.filter(isBoundedString, {
    identifier: "AssertionsBoundedJsonString",
    description: "a UTF-8 string no longer than 8 KiB",
  }),
);

const AssertionDisplayTextSchema = Schema.String.pipe(
  Schema.filter(isDisplayText, {
    identifier: "AssertionDisplayText",
    description: "text without control characters and at most 256 code points",
  }),
);

const CriterionIdentifierSchema = Schema.String.pipe(
  Schema.filter(isAsciiIdentifier, {
    identifier: "AssertionCriterionIdentifier",
    description: "a non-empty printable ASCII identifier no longer than 128 bytes",
  }),
);

const NonNegativeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeInteger, {
    identifier: "AssertionNonNegativeInteger",
    description: "a finite non-negative integer",
  }),
);

const PositiveIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0, {
    identifier: "AssertionPositiveInteger",
    description: "a positive safe integer",
  }),
);

const NonNegativeNumberSchema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeNumber, {
    identifier: "AssertionNonNegativeNumber",
    description: "a finite non-negative number",
  }),
);

function isJsonArrayIndex(key: string): boolean {
  if (key === "0") return true;
  if (!/^[1-9][0-9]*$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 4_294_967_295;
}

function isBoundedJsonValueAt(
  value: unknown,
  depth: number,
  active: WeakSet<object>,
): value is BoundedJsonValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isBoundedString(value);
  if (typeof value !== "object" || depth >= assertionRuntimeLimits.jsonDepth) return false;

  try {
    if (active.has(value)) return false;
    active.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || !hasAtMostArrayItems(value)) {
        return false;
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !isJsonArrayIndex(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return false;
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
        if (!isBoundedJsonValueAt(value[index], depth + 1, active)) return false;
      }
      return true;
    }

    const object = value;
    if (!isPlainJsonObject(object) || !hasAtMostObjectKeys(object)) return false;
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key !== "string" || !isBoundedString(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        return false;
      }
      if (!isBoundedJsonValueAt(descriptor.value, depth + 1, active)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    active.delete(value);
  }
}

function isBoundedJsonValue(value: unknown): value is BoundedJsonValue {
  return isBoundedJsonValueAt(value, 0, new WeakSet());
}

export function isBoundedJsonObject(value: unknown): value is BoundedJsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isBoundedJsonValueAt(value, 0, new WeakSet())
  );
}

/** @internal Raw descriptor preflight for direct Assertions Schema boundaries. */
export function isAssertionsRawDataGraph(
  value: unknown,
  active = new WeakSet<object>(),
): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object" || active.has(value)) return false;
  if (isRecordBlobRef(value)) return true;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const expected = new Set<string>(["length"]);
      for (let index = 0; index < value.length; index += 1) expected.add(String(index));
      const keys = Reflect.ownKeys(value);
      if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) {
        return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !("value" in descriptor) ||
          !isAssertionsRawDataGraph(descriptor.value, active)
        ) {
          return false;
        }
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor) ||
        !isAssertionsRawDataGraph(descriptor.value, active)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    active.delete(value);
  }
}

const BoundedJsonValueNodeSchema: Schema.Schema<BoundedJsonValue> = Schema.suspend(
  (): Schema.Schema<BoundedJsonValue> => Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.JsonNumber,
    BoundedJsonStringSchema,
    Schema.Array(BoundedJsonValueNodeSchema),
    Schema.Record({
      key: BoundedJsonStringSchema,
      value: BoundedJsonValueNodeSchema,
    }),
  ),
);

/** Recursive JSON shape plus the Assertions-specific depth and collection budgets. */
export const BoundedJsonValueSchema: Schema.Schema<BoundedJsonValue> =
  BoundedJsonValueNodeSchema.pipe(
    Schema.filter(isBoundedJsonValue, {
      identifier: "AssertionsBoundedJsonValue",
      description: "a recursive JSON value within the Assertions limits",
    }),
  );

export const BoundedJsonObjectSchema: Schema.Schema<BoundedJsonObject> = Schema.Record({
  key: BoundedJsonStringSchema,
  value: BoundedJsonValueNodeSchema,
}).pipe(
  Schema.filter(isBoundedJsonObject, {
    identifier: "AssertionsBoundedJsonObject",
    description: "a recursive JSON object within the Assertions limits",
  }),
);

export const AssertionEntryIdSchema: Schema.Schema<AssertionEntryId, string> =
  Schema.String.pipe(
    Schema.filter(isAssertionEntryId, {
      identifier: "AssertionEntryId",
      description: "an attachment-local ae_ identifier with 20 lowercase base-36 characters",
    }),
    Schema.brand(ASSERTION_ENTRY_ID_BRAND),
  );

export const AssertionDisplaySchema: Schema.Schema<AssertionDisplay> =
  Schema.Struct({
    key: Schema.optional(AssertionDisplayTextSchema),
    label: Schema.optional(AssertionDisplayTextSchema),
    groupPath: Schema.Array(AssertionDisplayTextSchema).pipe(
      Schema.filter((groupPath) => groupPath.length <= assertionRuntimeLimits.groupDepth, {
        identifier: "AssertionDisplayGroupPath",
        description: "a group path no deeper than 16 segments",
      }),
    ),
  });

export const BuiltInCriterionEnvelopeSchema: Schema.Schema<BuiltInCriterionEnvelope> =
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: CriterionIdentifierSchema,
    data: BoundedJsonValueSchema,
  });

export const ThirdPartyCriterionSchema: Schema.Schema<ThirdPartyCriterion> =
  Schema.Struct({
    name: CriterionIdentifierSchema,
    schemaId: CriterionIdentifierSchema,
    data: BoundedJsonValueSchema,
  });

export const CriterionOuterEnvelopeSchema: Schema.Schema<CriterionOuterEnvelope> =
  Schema.Union(BuiltInCriterionEnvelopeSchema, ThirdPartyCriterionSchema);

const ValueMatchCriterionSchema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("value-match/v1"),
  data: Schema.Struct({
    subject: Schema.Literal("explicit-value"),
    matcher: Schema.Union(
      Schema.Struct({ state: Schema.Literal("declared"), name: BoundedJsonStringSchema }),
      Schema.Struct({ state: Schema.Literal("unavailable") }),
    ),
  }),
});

const ScopeStatusCriterionSchema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("scope-status/v1"),
  data: Schema.Struct({
    scope: Schema.Literal("turn", "session", "attempt"),
    assertion: Schema.Literal("succeeded", "no-failed-actions"),
  }),
});

const OccurrenceCriterionSchema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("occurrence/v1"),
  data: Schema.Struct({
    scope: Schema.Literal("turn", "session", "attempt"),
    occurrence: Schema.Literal("tool", "skill", "event"),
    assertion: Schema.Literal("present", "absent", "count"),
    matcher: Schema.optional(BoundedJsonStringSchema),
    quantifier: Schema.optional(Schema.Union(
      Schema.Struct({ kind: Schema.Literal("absent") }),
      Schema.Struct({
        kind: Schema.Literal("at-least", "exact"),
        count: PositiveIntegerSchema,
      }),
    )),
  }),
});

const JudgeMeasurementCriterionSchema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("judge-measurement/v1"),
  data: Schema.Struct({
    recipe: Schema.Literal("closed-qa", "factuality", "summarizes"),
    scale: Schema.Literal("unit-interval"),
  }),
});

const SandboxResultCriterionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literal("sandbox-result/v1"),
    data: Schema.Struct({
      operation: Schema.Literal("changed-paths"),
      paths: Schema.Array(BoundedJsonStringSchema),
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literal("sandbox-result/v1"),
    data: Schema.Struct({ operation: Schema.Literal("no-changes") }),
  }),
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literal("sandbox-result/v1"),
    data: Schema.Struct({
      operation: Schema.Literal("file-changed"),
      path: BoundedJsonStringSchema,
      status: Schema.optional(Schema.Literal("added", "modified", "deleted")),
      before: Schema.optional(BoundedJsonStringSchema),
      after: Schema.optional(BoundedJsonStringSchema),
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literal("sandbox-result/v1"),
    data: Schema.Struct({
      operation: Schema.Literal("file-deleted"),
      path: BoundedJsonStringSchema,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: Schema.Literal("sandbox-result/v1"),
    data: Schema.Struct({
      operation: Schema.Literal("not-in-diff"),
      pattern: BoundedJsonStringSchema,
      flags: BoundedJsonStringSchema,
      content: Schema.Literal("added", "removed", "both"),
    }),
  }),
);

const DirectScoreCriterionSchema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("direct-score/v1"),
  data: Schema.Struct({ source: Schema.Literal("author") }),
});

export const BuiltInCriterionSchema: Schema.Schema<BuiltInCriterion> =
  Schema.Union(
    ValueMatchCriterionSchema,
    ScopeStatusCriterionSchema,
    OccurrenceCriterionSchema,
    JudgeMeasurementCriterionSchema,
    SandboxResultCriterionSchema,
    DirectScoreCriterionSchema,
  );

export const CriterionEnvelopeSchema: Schema.Schema<WritableCriterionEnvelope> =
  Schema.Union(BuiltInCriterionSchema, ThirdPartyCriterionSchema);

export const AssertionCoverageSchema: Schema.Schema<AssertionCoverage> =
  Schema.Union(
    Schema.Struct({ state: Schema.Literal("complete") }),
    Schema.Struct({
      state: Schema.Literal("partial"),
      reason: Schema.Literal("sampled", "truncated", "redacted", "provider-limited"),
    }),
    Schema.Struct({
      state: Schema.Literal("unavailable"),
      reason: Schema.Literal("not-collected", "source-unavailable", "producer-failed"),
    }),
    Schema.Struct({
      state: Schema.Literal("not-applicable"),
      reason: Schema.Literal("optional-material", "unsupported-subject"),
    }),
  );

export const AssertionLimitationSchema: Schema.Schema<AssertionLimitation> =
  Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("redacted"),
      fieldCount: NonNegativeIntegerSchema,
    }),
    Schema.Struct({
      kind: Schema.Literal("sampled"),
      captured: NonNegativeIntegerSchema,
      knownTotal: Schema.optional(NonNegativeIntegerSchema),
    }),
    Schema.Struct({
      kind: Schema.Literal("truncated"),
      omittedBytes: NonNegativeIntegerSchema,
    }),
    Schema.Struct({ kind: Schema.Literal("provider-limited") }),
  );

const NoScoreContributionSchema: Schema.Schema<NoScoreContribution> =
  Schema.Struct({ state: Schema.Literal("not-scored") });

const EarnedScoreContributionSchema: Schema.Schema<EarnedScoreContribution> =
  Schema.Struct({
    state: Schema.Literal("earned"),
    points: NonNegativeNumberSchema,
    earned: NonNegativeNumberSchema,
  }).pipe(
    Schema.filter((score) => score.earned <= score.points, {
      identifier: "AssertionEarnedScore",
      description: "an earned score no greater than its points",
    }),
  );

const UnavailableScoreContributionSchema: Schema.Schema<UnavailableScoreContribution> =
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    points: NonNegativeNumberSchema,
    reason: Schema.Literal("source-unavailable", "evaluation-errored", "not-applicable"),
  });

const AssertionCollectionReceiptSchema = Schema.Struct({
  examined: NonNegativeIntegerSchema,
  matched: NonNegativeIntegerSchema,
  mismatched: NonNegativeIntegerSchema,
  unavailable: NonNegativeIntegerSchema,
  knownTotal: Schema.NullOr(NonNegativeIntegerSchema),
  complete: Schema.Boolean,
  exhaustive: Schema.Boolean,
  decisive: Schema.Boolean,
});

const AssertionFactValueSchema: Schema.Schema<AssertionFactValue> = Schema.suspend(
  (): Schema.Schema<AssertionFactValue> => Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("unavailable"),
      reason: Schema.Literal("not-recorded", "not-declared", "source-unavailable"),
    }),
    Schema.Struct({ kind: Schema.Literal("value"), value: Schema.Union(Schema.Null, Schema.Boolean, Schema.JsonNumber, BoundedJsonStringSchema) }),
    Schema.Struct({ kind: Schema.Literal("text"), text: BoundedJsonStringSchema }),
    Schema.Struct({ kind: Schema.Literal("list"), items: Schema.Array(AssertionFactValueSchema) }),
    Schema.Struct({
      kind: Schema.Literal("fields"),
      fields: Schema.Array(Schema.Struct({ label: BoundedJsonStringSchema, value: AssertionFactValueSchema })),
    }),
  ),
);

const AssertionDecisionPolicySchema = Schema.Struct({
  requirement: Schema.Union(
    Schema.Struct({
      state: Schema.Literal("available"),
      value: Schema.Literal("required", "optional"),
    }),
    Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
  ),
  condition: Schema.Union(
    Schema.Struct({
      state: Schema.Literal("available"),
      value: Schema.Union(
      Schema.Struct({ kind: Schema.Literal("boolean"), expected: Schema.Literal(true) }),
      Schema.Struct({ kind: Schema.Literal("at-least"), threshold: NonNegativeNumberSchema }),
      Schema.Struct({ kind: Schema.Literal("record-only") }),
      ),
    }),
    Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
  ),
});

export const SealedAssertionResultSchema: Schema.Schema<SealedAssertionResult> =
  Schema.Union(
    Schema.Struct({
      state: Schema.Literal("matched"),
      gate: Schema.Literal("not-gate", "satisfied"),
      score: Schema.Union(NoScoreContributionSchema, EarnedScoreContributionSchema),
      diagnostic: Schema.optional(BoundedJsonObjectSchema),
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
    Schema.Struct({
      state: Schema.Literal("mismatched"),
      reason: Schema.Literal("condition-not-met"),
      gate: Schema.Literal("not-gate", "failed"),
      score: Schema.Union(NoScoreContributionSchema, EarnedScoreContributionSchema),
      diagnostic: Schema.optional(BoundedJsonObjectSchema),
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
    Schema.Struct({
      state: Schema.Literal("unavailable"),
      reason: Schema.Literal("evidence-unavailable", "source-unavailable", "redacted"),
      gate: Schema.Literal("not-gate", "unavailable"),
      score: Schema.Union(NoScoreContributionSchema, UnavailableScoreContributionSchema),
      diagnostic: Schema.optional(BoundedJsonObjectSchema),
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
    Schema.Struct({
      state: Schema.Literal("errored"),
      reason: Schema.Literal("evaluator-failed", "producer-interrupted", "invalid-subject"),
      gate: Schema.Literal("not-gate", "unavailable"),
      score: Schema.Union(NoScoreContributionSchema, UnavailableScoreContributionSchema),
      diagnostic: Schema.optional(BoundedJsonObjectSchema),
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
    Schema.Struct({
      state: Schema.Literal("not-applicable"),
      reason: Schema.Literal("coverage-not-applicable"),
      gate: Schema.Literal("not-gate", "not-applicable"),
      score: Schema.Union(NoScoreContributionSchema, UnavailableScoreContributionSchema),
      diagnostic: Schema.optional(BoundedJsonObjectSchema),
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
  );

/**
 * Record owns the opaque blob-ref codec.  Assertions owns only its shape and
 * its ordered projection, so the same exact outer schema can be used for
 * generic Record reads and for producer sealing.
 */
export function createAssertionsRecordSchemas<BlobRef, BlobRefEncoded>(
  blobRefSchema: Schema.Schema<BlobRef, BlobRefEncoded>,
) {
  const material = Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("snapshot"),
      value: BoundedJsonValueSchema,
    }),
    Schema.Struct({
      kind: Schema.Literal("blob"),
      ref: blobRefSchema,
      encoding: Schema.Literal("utf-8", "binary"),
      byteLength: NonNegativeIntegerSchema,
      sha256: Sha256DigestSchema,
      preview: BoundedJsonStringSchema,
    }),
  );

  const evidence = Schema.Array(material);
  const limitations = Schema.Array(AssertionLimitationSchema);

  const historicalOuterEntry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplaySchema,
    criterion: BoundedJsonObjectSchema,
    subject: material,
    evidence,
    coverage: AssertionCoverageSchema,
    limitations,
    result: SealedAssertionResultSchema,
  }).pipe(
    Schema.filter(hasCoverageConsistentLimitations, {
      identifier: "AssertionCoverageLimitations",
      description: "coverage and limitations with a consistent sealed relationship",
    }),
  );

  const materials = Schema.Struct({
    source: material,
    evidence,
    coverage: AssertionCoverageSchema,
    limitations,
  }).pipe(Schema.filter((value) => hasCoverageConsistentLimitations(value), {
    identifier: "AssertionCoverageLimitations",
    description: "coverage and limitations with a consistent sealed relationship",
  }));
  const evaluation = Schema.Struct({
    observed: AssertionFactValueSchema,
    receipt: Schema.optional(AssertionCollectionReceiptSchema),
  });
  const decision = Schema.Struct({
    result: Schema.Literal("matched", "mismatched", "unavailable", "errored", "not-applicable"),
    reason: Schema.NullOr(Schema.Literal(
      "condition-not-met", "evidence-unavailable", "source-unavailable", "redacted",
      "evaluator-failed", "producer-interrupted", "invalid-subject", "coverage-not-applicable",
    )),
    gate: Schema.Literal("not-gate", "satisfied", "failed", "unavailable", "not-applicable"),
  });
  const explanationRetention = Schema.Union(
    Schema.Struct({ state: Schema.Literal("retained"), value: AssertionFactValueSchema }),
    Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
  );

  const outerEntry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplaySchema,
    criterion: Schema.Union(
      Schema.Struct({ state: Schema.Literal("available"), value: BoundedJsonObjectSchema }),
      Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
    ),
    materials,
    evaluation,
    decision,
    policy: AssertionDecisionPolicySchema,
    contribution: Schema.Union(NoScoreContributionSchema, EarnedScoreContributionSchema, UnavailableScoreContributionSchema),
    explanationRetention,
  });

  const historicalEntries = Schema.Array(historicalOuterEntry).pipe(
    Schema.filter((values) => values.length <= assertionRuntimeLimits.entries, {
      identifier: "AssertionsEntryCount",
      description: "at most 4,096 assertion entries",
    }),
  );

  const entries = Schema.Array(outerEntry).pipe(
    Schema.filter((values) => values.length <= assertionRuntimeLimits.entries, {
      identifier: "AssertionsEntryCount",
      description: "at most 4,096 assertion entries",
    }),
  );

  const outerDocument = Schema.Struct({ entries }).pipe(
    Schema.filter(hasUniqueEntryIds, {
      identifier: "AssertionsUniqueEntryIds",
      description: "unique attachment-local assertion entry IDs",
    }),
    Schema.filter(isDocumentWithinSizeLimit, {
      identifier: "AssertionsDocumentSize",
      description: "a JSON document no larger than 4 MiB",
    }),
  );

  const entry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplaySchema,
    criterion: Schema.Union(
      Schema.Struct({ state: Schema.Literal("available"), value: CriterionEnvelopeSchema }),
      Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
    ),
    materials,
    evaluation,
    decision,
    policy: AssertionDecisionPolicySchema,
    contribution: Schema.Union(NoScoreContributionSchema, EarnedScoreContributionSchema, UnavailableScoreContributionSchema),
    explanationRetention,
  });

  const document = Schema.Struct({
    entries: Schema.Array(entry).pipe(
      Schema.filter((entries) => entries.length <= assertionRuntimeLimits.entries, {
        identifier: "AssertionsEntryCount",
        description: "at most 4,096 assertion entries",
      }),
    ),
  }).pipe(
    Schema.filter(hasUniqueEntryIds, {
      identifier: "AssertionsUniqueEntryIds",
      description: "unique attachment-local assertion entry IDs",
    }),
    Schema.filter(isDocumentWithinSizeLimit, {
      identifier: "AssertionsDocumentSize",
      description: "a JSON document no larger than 4 MiB",
    }),
  );

  return Object.freeze({ material, entries, historicalEntries, outerDocument, document });
}

export interface AssertionsRecordCodecError {
  readonly code: "assertions-document-invalid";
}

const assertionsDocumentInvalid: AssertionsRecordCodecError = Object.freeze({
  code: "assertions-document-invalid",
});

export function decodeAssertionsDocumentOuter<BlobRef, Encoded>(
  schema: Schema.Schema<AssertionsDocumentOuter<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<AssertionsDocumentOuter<BlobRef>, AssertionsRecordCodecError> {
  if (!isAssertionsRawDataGraph(input)) return Either.left(assertionsDocumentInvalid);
  const decoded = Schema.decodeUnknownEither(
    schema,
    AssertionsExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionsDocumentInvalid)
    : Either.right(decoded.right);
}

export function decodeAssertionsDocument<BlobRef, Encoded>(
  schema: Schema.Schema<AssertionsDocument<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<AssertionsDocument<BlobRef>, AssertionsRecordCodecError> {
  if (!isAssertionsRawDataGraph(input)) return Either.left(assertionsDocumentInvalid);
  const decoded = Schema.decodeUnknownEither(
    schema,
    AssertionsExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionsDocumentInvalid)
    : Either.right(decoded.right);
}

export interface ThirdPartyCriterionDefinition {
  readonly name: string;
  readonly schemaId: string;
  readonly dataSchema: Schema.Schema.AnyNoContext;
}

export interface ThirdPartyCriterionRegistry {
  readonly lookup: (
    name: string,
    schemaId: string,
  ) => ThirdPartyCriterionDefinition | undefined;
}

export type ThirdPartyCriterionRegistryError =
  | {
      readonly code: "third-party-criterion-identity-invalid";
      readonly name: string;
      readonly schemaId: string;
    }
  | {
      readonly code: "third-party-criterion-duplicate";
      readonly name: string;
      readonly schemaId: string;
    };

function thirdPartyCriterionKey(name: string, schemaId: string): string {
  return `${name}\u0000${schemaId}`;
}

export function makeThirdPartyCriterionRegistry(
  definitions: readonly ThirdPartyCriterionDefinition[],
): Either.Either<ThirdPartyCriterionRegistry, ThirdPartyCriterionRegistryError> {
  const byIdentity = new Map<string, ThirdPartyCriterionDefinition>();
  for (const definition of definitions) {
    if (!isAsciiIdentifier(definition.name) || !isAsciiIdentifier(definition.schemaId)) {
      return Either.left({
        code: "third-party-criterion-identity-invalid",
        name: definition.name,
        schemaId: definition.schemaId,
      });
    }
    const key = thirdPartyCriterionKey(definition.name, definition.schemaId);
    if (byIdentity.has(key)) {
      return Either.left({
        code: "third-party-criterion-duplicate",
        name: definition.name,
        schemaId: definition.schemaId,
      });
    }
    byIdentity.set(key, Object.freeze({ ...definition }));
  }
  return Either.right(Object.freeze({
    lookup(name: string, schemaId: string) {
      return byIdentity.get(thirdPartyCriterionKey(name, schemaId));
    },
  }));
}

const KNOWN_BUILTIN_CRITERION_IDS: ReadonlySet<string> = new Set([
  "value-match/v1",
  "scope-status/v1",
  "occurrence/v1",
  "judge-measurement/v1",
  "sandbox-result/v1",
  "direct-score/v1",
]);

function availableEntry<BlobRef>(
  entry: AssertionEntryOuter<BlobRef>,
  criterion: WritableCriterionEnvelope,
): AssertionEntryRead<BlobRef> {
  const available: AssertionEntry<BlobRef> = {
    ...entry,
    criterion: Object.freeze({ state: "available" as const, value: criterion }),
  };
  return Object.freeze({ state: "available", entry: Object.freeze(available) });
}

function projectAssertionEntry<BlobRef>(
  entry: AssertionEntryOuter<BlobRef>,
  registry: ThirdPartyCriterionRegistry,
): AssertionEntryRead<BlobRef> {
  if (entry.criterion.state === "unavailable") {
    return Object.freeze({ state: "available", entry: entry as AssertionEntry<BlobRef> });
  }
  const criterionValue = entry.criterion.value;
  const builtinEnvelope = Schema.decodeUnknownEither(
    BuiltInCriterionEnvelopeSchema,
    AssertionsExactParseOptions,
  )(criterionValue);
  if (Either.isRight(builtinEnvelope)) {
    const builtin = Schema.decodeUnknownEither(
      BuiltInCriterionSchema,
      AssertionsExactParseOptions,
    )(criterionValue);
    if (Either.isRight(builtin)) {
      return availableEntry(entry, builtin.right);
    }
    if (KNOWN_BUILTIN_CRITERION_IDS.has(builtinEnvelope.right.id)) {
      return Object.freeze({
        state: "invalid",
        entry,
        reason: "criterion-data-invalid",
      });
    }
    return Object.freeze({
      state: "unsupported",
      entry,
      reason: "builtin-unknown",
    });
  }

  const thirdParty = Schema.decodeUnknownEither(
    ThirdPartyCriterionSchema,
    AssertionsExactParseOptions,
  )(criterionValue);
  if (Either.isLeft(thirdParty)) {
    return Object.freeze({
      state: "invalid",
      entry,
      reason: "criterion-envelope-invalid",
    });
  }

  const definition = registry.lookup(thirdParty.right.name, thirdParty.right.schemaId);
  if (definition === undefined) {
    return Object.freeze({
      state: "unsupported",
      entry,
      reason: "third-party-schema-unavailable",
    });
  }
  const data = Schema.decodeUnknownEither(
    definition.dataSchema,
    AssertionsExactParseOptions,
  )(thirdParty.right.data);
  if (Either.isLeft(data)) {
    return Object.freeze({
      state: "invalid",
      entry,
      reason: "criterion-data-invalid",
    });
  }
  return availableEntry(entry, thirdParty.right);
}

/**
 * Projection is synchronous and never re-evaluates an Assertion.  Its only
 * dynamic work is criterion interpretation inside each already-valid entry.
 */
export function projectAssertionsDocument<BlobRef>(
  document: AssertionsDocumentOuter<BlobRef>,
  registry: ThirdPartyCriterionRegistry,
): AssertionsProjection<BlobRef> {
  return Object.freeze({
    entries: Object.freeze(
      document.entries.map((entry) => projectAssertionEntry(entry, registry)),
    ),
  });
}
