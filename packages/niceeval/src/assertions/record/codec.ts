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
  type MatcherQueryArtifact,
  type MatcherSourceSnapshot,
  type SealedAssertionResult,
  type ThirdPartyCriterion,
  type UnavailableScoreContribution,
  type WritableCriterionEnvelope,
} from "./model.ts";

/** Durable document-size limit; unlike runtime capture limits it belongs to this codec. */
export const MAX_ASSERTION_DOCUMENT_BYTES = 4 * 1_024 * 1_024;
export const MAX_MATCHER_QUERY_ARTIFACT_BYTES = 64 * 1_024;

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

const MatcherIdentitySchema = BoundedJsonStringSchema.pipe(
  Schema.filter((value) => value.length > 0 && !CONTROL_CHARACTER.test(value), {
    identifier: "MatcherSourceIdentity",
    description: "a non-empty bounded source identity without control characters",
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

function hasValidCollectionReceipt(receipt: {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number | null;
  readonly complete: boolean;
  readonly exhaustive: boolean;
}): boolean {
  if (receipt.matched + receipt.mismatched + receipt.unavailable !== receipt.examined) {
    return false;
  }
  if (receipt.knownTotal !== null && receipt.examined > receipt.knownTotal) return false;
  if (receipt.complete && receipt.knownTotal === null) return false;
  return !receipt.exhaustive || (
    receipt.knownTotal !== null && receipt.examined === receipt.knownTotal
  );
}

export const AssertionCollectionReceiptSchema = Schema.Struct({
  examined: NonNegativeIntegerSchema,
  matched: NonNegativeIntegerSchema,
  mismatched: NonNegativeIntegerSchema,
  unavailable: NonNegativeIntegerSchema,
  knownTotal: Schema.NullOr(NonNegativeIntegerSchema),
  complete: Schema.Boolean,
  exhaustive: Schema.Boolean,
  decisive: Schema.Boolean,
}).pipe(
  Schema.filter(hasValidCollectionReceipt, {
    identifier: "AssertionCollectionReceipt",
    description: "a collection receipt whose counts and completion boundary agree",
  }),
);

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

const MatcherRelationStatusSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("exact") }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literal(
      "historical-not-recorded",
      "source-unavailable",
      "ambiguous",
    ),
  }),
);

const MatcherSourceLocatorSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("tool-occurrence"),
    toolOccurrenceId: MatcherIdentitySchema,
    relation: MatcherRelationStatusSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    eventId: MatcherIdentitySchema,
    toolOccurrenceId: Schema.optional(MatcherIdentitySchema),
    relation: MatcherRelationStatusSchema,
  }),
);

const MatcherRetainedRowSchema = Schema.Struct({
  locator: MatcherSourceLocatorSchema,
  result: Schema.Literal("matched", "mismatched", "unavailable", "not-evaluated"),
  difference: Schema.optional(AssertionFactValueSchema),
});

const MatcherRetainedRowsSchema = Schema.Array(MatcherRetainedRowSchema).pipe(
  Schema.filter((rows) => rows.length <= 8, {
    identifier: "MatcherRetainedRows",
    description: "at most eight representative matcher rows",
  }),
);

const MatcherQueryStepSchema = Schema.Struct({
  step: PositiveIntegerSchema,
  summary: AssertionFactValueSchema,
});

const MatcherSourceReferenceSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  schemaVersion: PositiveIntegerSchema,
});

const MatcherSourceCollectionStateSchema = Schema.Literal(
  "complete",
  "partial",
  "unavailable",
);

const MatcherTurnSourceSnapshotSchema = Schema.Struct({
  scope: Schema.Literal("turn"),
  sessionId: MatcherIdentitySchema,
  turnId: MatcherIdentitySchema,
  scopeId: MatcherIdentitySchema,
  throughSessionSequence: NonNegativeIntegerSchema,
  source: MatcherSourceReferenceSchema,
  collectionAtCut: MatcherSourceCollectionStateSchema,
});

const MatcherSessionSourceSnapshotSchema = Schema.Struct({
  scope: Schema.Literal("session"),
  sessionId: MatcherIdentitySchema,
  scopeId: MatcherIdentitySchema,
  throughSessionSequence: NonNegativeIntegerSchema,
  source: MatcherSourceReferenceSchema,
  collectionAtCut: MatcherSourceCollectionStateSchema,
});

const MatcherAttemptSourceSnapshotSchema = Schema.Struct({
  scope: Schema.Literal("attempt"),
  scopeId: MatcherIdentitySchema,
  sessions: Schema.Array(Schema.Struct({
    sessionId: MatcherIdentitySchema,
    throughSessionSequence: NonNegativeIntegerSchema,
  })).pipe(
    Schema.filter((sessions) => sessions.every((session, index) =>
      index === 0 || sessions[index - 1]!.sessionId < session.sessionId
    ), {
      identifier: "MatcherAttemptVectorCut",
      description: "a unique vector cut in canonical session identity order",
    }),
  ),
  source: MatcherSourceReferenceSchema,
  collectionAtCut: MatcherSourceCollectionStateSchema,
});

export const MatcherSourceSnapshotSchema: Schema.Schema<MatcherSourceSnapshot> =
  Schema.Union(
    MatcherTurnSourceSnapshotSchema,
    MatcherSessionSourceSnapshotSchema,
    MatcherAttemptSourceSnapshotSchema,
  );

const OrderStepReceiptSchema = Schema.Struct({
  step: PositiveIntegerSchema,
  comparisons: NonNegativeIntegerSchema,
  matched: NonNegativeIntegerSchema,
  mismatched: NonNegativeIntegerSchema,
  unavailable: NonNegativeIntegerSchema,
}).pipe(
  Schema.filter((receipt) =>
    receipt.matched + receipt.mismatched + receipt.unavailable === receipt.comparisons, {
      identifier: "MatcherOrderStepReceipt",
      description: "an order step receipt whose result counts equal its comparisons",
    }),
);

const OrderEvaluationReceiptSchema = Schema.Struct({
  sourceRows: NonNegativeIntegerSchema,
  comparisons: NonNegativeIntegerSchema,
  unavailableComparisons: NonNegativeIntegerSchema,
  definitePrefixLength: NonNegativeIntegerSchema,
  possiblePrefixLength: NonNegativeIntegerSchema,
  stepReceipts: Schema.Array(OrderStepReceiptSchema),
  complete: Schema.Boolean,
  exhaustive: Schema.Boolean,
  decisive: Schema.Boolean,
});

const MatcherOrderPathNodeSchema = Schema.Struct({
  step: PositiveIntegerSchema,
  locator: MatcherSourceLocatorSchema,
  sessionId: MatcherIdentitySchema,
  sessionSequence: PositiveIntegerSchema,
  result: Schema.Literal("matched", "unavailable"),
});

const MatcherFailureFrontierSchema = Schema.Struct({
  longestDefinitePrefix: Schema.Array(MatcherOrderPathNodeSchema),
  longestPossiblePrefix: Schema.Array(MatcherOrderPathNodeSchema),
  firstBlockingStep: PositiveIntegerSchema,
  suffixChecked: AssertionCollectionReceiptSchema,
  representatives: MatcherRetainedRowsSchema,
});

function isPathWithinSourceCut(
  path: readonly Schema.Schema.Type<typeof MatcherOrderPathNodeSchema>[],
  snapshot: Schema.Schema.Type<typeof MatcherTurnSourceSnapshotSchema> |
    Schema.Schema.Type<typeof MatcherSessionSourceSnapshotSchema>,
  expectedLength: number,
  allowed: "matched" | "possible",
): boolean {
  if (path.length !== expectedLength) return false;
  let previousSequence = 0;
  for (const [index, node] of path.entries()) {
    if (
      node.step !== index + 1 ||
      node.sessionId !== snapshot.sessionId ||
      node.sessionSequence <= previousSequence ||
      node.sessionSequence > snapshot.throughSessionSequence ||
      (allowed === "matched" && node.result !== "matched") ||
      (node.result === "matched" && node.locator.relation.state !== "exact")
    ) {
      return false;
    }
    previousSequence = node.sessionSequence;
  }
  return true;
}

function hasValidOrderedArtifact(
  artifact: Schema.Schema.Type<typeof MatcherOrderedSequenceShapeSchema>,
): boolean {
  const stepCount = artifact.querySteps.length;
  const receipt = artifact.receipt;
  if (
    artifact.querySteps.some((step, index) => step.step !== index + 1) ||
    receipt.stepReceipts.length !== stepCount ||
    receipt.stepReceipts.some((step, index) => step.step !== index + 1) ||
    receipt.definitePrefixLength > receipt.possiblePrefixLength ||
    receipt.possiblePrefixLength > stepCount ||
    receipt.comparisons !== receipt.stepReceipts.reduce((sum, step) => sum + step.comparisons, 0) ||
    receipt.unavailableComparisons !== receipt.stepReceipts.reduce((sum, step) => sum + step.unavailable, 0) ||
    receipt.complete !== (artifact.sourceSnapshot.collectionAtCut === "complete") ||
    receipt.stepReceipts.some((step) => step.comparisons > receipt.sourceRows) ||
    receipt.stepReceipts.some((step, index) =>
      index > 0 && step.comparisons !== receipt.stepReceipts[0]!.comparisons
    ) ||
    (receipt.exhaustive && receipt.stepReceipts.some((step) =>
      step.comparisons !== receipt.sourceRows
    ))
  ) {
    return false;
  }
  switch (artifact.result.state) {
    case "matched":
      return receipt.definitePrefixLength === stepCount &&
        receipt.possiblePrefixLength === stepCount &&
        receipt.decisive &&
        isPathWithinSourceCut(
          artifact.result.witnessPath,
          artifact.sourceSnapshot,
          stepCount,
          "matched",
        );
    case "mismatched": {
      const frontier = artifact.result.failureFrontier;
      return receipt.complete && receipt.exhaustive && receipt.decisive &&
        receipt.possiblePrefixLength < stepCount &&
        frontier.firstBlockingStep === receipt.possiblePrefixLength + 1 &&
        frontier.suffixChecked.complete &&
        frontier.suffixChecked.exhaustive &&
        frontier.suffixChecked.decisive &&
        frontier.suffixChecked.knownTotal === frontier.suffixChecked.examined &&
        frontier.suffixChecked.matched === 0 &&
        frontier.suffixChecked.unavailable === 0 &&
        isPathWithinSourceCut(
          frontier.longestDefinitePrefix,
          artifact.sourceSnapshot,
          receipt.definitePrefixLength,
          "matched",
        ) &&
        isPathWithinSourceCut(
          frontier.longestPossiblePrefix,
          artifact.sourceSnapshot,
          receipt.possiblePrefixLength,
          "possible",
        );
    }
    case "unavailable":
      return artifact.result.reason.length > 0 && !receipt.decisive;
  }
}

const MatcherCollectionFilterSchema = Schema.Struct({
  kind: Schema.Literal("collection-filter"),
  sourceSnapshot: MatcherSourceSnapshotSchema,
  query: MatcherQueryStepSchema,
  receipt: AssertionCollectionReceiptSchema,
  retainedRows: MatcherRetainedRowsSchema,
}).pipe(
  Schema.filter((artifact) =>
    artifact.query.step === 1 &&
    artifact.receipt.knownTotal !== null &&
    artifact.receipt.complete === (artifact.sourceSnapshot.collectionAtCut === "complete"), {
      identifier: "MatcherCollectionFilterArtifact",
      description: "a collection matcher artifact with one query and a matching source cut",
    }),
);

const MatcherOrderedSequenceShapeSchema = Schema.Struct({
  kind: Schema.Literal("ordered-sequence"),
  sourceSnapshot: Schema.Union(
    MatcherTurnSourceSnapshotSchema,
    MatcherSessionSourceSnapshotSchema,
  ),
  querySteps: Schema.Array(MatcherQueryStepSchema).pipe(
    Schema.filter((steps) => steps.length >= 2 && steps.length <= 64, {
      identifier: "MatcherOrderQuerySteps",
      description: "between two and 64 ordered matcher query steps",
    }),
  ),
  receipt: OrderEvaluationReceiptSchema,
  result: Schema.Union(
    Schema.Struct({
      state: Schema.Literal("matched"),
      witnessPath: Schema.Array(MatcherOrderPathNodeSchema),
    }),
    Schema.Struct({
      state: Schema.Literal("mismatched"),
      failureFrontier: MatcherFailureFrontierSchema,
    }),
    Schema.Struct({
      state: Schema.Literal("unavailable"),
      reason: MatcherIdentitySchema,
    }),
  ),
  retainedRows: MatcherRetainedRowsSchema,
});

const MatcherOrderedSequenceSchema = MatcherOrderedSequenceShapeSchema.pipe(
  Schema.filter(hasValidOrderedArtifact, {
    identifier: "MatcherOrderedSequenceArtifact",
    description: "an ordered matcher artifact with consistent receipts, paths, and cut",
  }),
);

function isMatcherArtifactWithinSizeLimit(value: unknown): boolean {
  try {
    return utf8ByteLength(JSON.stringify(value)) <= MAX_MATCHER_QUERY_ARTIFACT_BYTES;
  } catch {
    return false;
  }
}

export const MatcherQueryArtifactSchema: Schema.Schema<MatcherQueryArtifact> =
  Schema.Union(MatcherCollectionFilterSchema, MatcherOrderedSequenceSchema).pipe(
    Schema.filter(isMatcherArtifactWithinSizeLimit, {
      identifier: "MatcherQueryArtifactSize",
      description: "a matcher query artifact no larger than 64 KiB",
    }),
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
      kind: Schema.Literal("unavailable"),
      reason: Schema.Literal("not-recorded"),
    }),
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
  const historicalV2Evaluation = Schema.Struct({
    observed: AssertionFactValueSchema,
    receipt: Schema.optional(AssertionCollectionReceiptSchema),
  });
  const evaluation = Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("ordinary"),
      observed: AssertionFactValueSchema,
      receipt: Schema.optional(AssertionCollectionReceiptSchema),
    }),
    Schema.Struct({
      kind: Schema.Literal("matcher-current"),
      observed: AssertionFactValueSchema,
      artifact: MatcherQueryArtifactSchema,
      receipt: Schema.optional(Schema.Never),
    }),
    Schema.Struct({
      kind: Schema.Literal("matcher-legacy"),
      observed: AssertionFactValueSchema,
      reason: Schema.Literal("historical-not-recorded"),
      legacyDiagnostic: Schema.optional(AssertionFactValueSchema),
      receipt: Schema.optional(Schema.Never),
    }),
  );
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

  const historicalV2OuterEntry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplaySchema,
    criterion: Schema.Union(
      Schema.Struct({ state: Schema.Literal("available"), value: BoundedJsonObjectSchema }),
      Schema.Struct({ state: Schema.Literal("unavailable"), reason: Schema.Literal("not-recorded") }),
    ),
    materials,
    evaluation: historicalV2Evaluation,
    decision,
    policy: AssertionDecisionPolicySchema,
    contribution: Schema.Union(NoScoreContributionSchema, EarnedScoreContributionSchema, UnavailableScoreContributionSchema),
    explanationRetention,
  });

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
  }).pipe(
    Schema.filter((entry) =>
      entry.evaluation.kind === "ordinary" ||
      entry.explanationRetention.state === "unavailable", {
        identifier: "MatcherExplanationOwnership",
        description: "matcher artifacts and legacy diagnostics are not duplicated in explanation retention",
      }),
  );

  const historicalEntries = Schema.Array(historicalOuterEntry).pipe(
    Schema.filter((values) => values.length <= assertionRuntimeLimits.entries, {
      identifier: "AssertionsEntryCount",
      description: "at most 4,096 assertion entries",
    }),
  );

  const historicalV2Entries = Schema.Array(historicalV2OuterEntry).pipe(
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

  return Object.freeze({
    material,
    entries,
    historicalEntries,
    historicalV2Entries,
    outerDocument,
    document,
  });
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
