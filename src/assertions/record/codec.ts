import { Either, Schema } from "effect";
import {
  ASSERTION_ENTRY_ID_BRAND,
  type AssertionCoverageV1,
  type AssertionDisplayV1,
  type AssertionEntryId,
  type AssertionEntryOuterV1,
  type AssertionEntryReadV1,
  type AssertionEntryV1,
  type AssertionLimitationV1,
  type AssertionMaterialV1,
  type AssertionsDocumentOuterV1,
  type AssertionsDocumentV1,
  type AssertionsProjectionV1,
  type BoundedJsonObjectV1,
  type BoundedJsonValueV1,
  type BuiltInCriterionEnvelopeV1,
  type BuiltInCriterionV1,
  type CriterionOuterEnvelopeV1,
  type EarnedScoreContributionV1,
  type NoScoreContributionV1,
  type SealedAssertionResultV1,
  type ThirdPartyCriterionV1,
  type UnavailableScoreContributionV1,
  type WritableCriterionEnvelopeV1,
} from "./model.ts";

export const MAX_ASSERTION_ENTRIES_V1 = 4_096;
export const MAX_ASSERTION_GROUP_DEPTH_V1 = 16;
export const MAX_ASSERTION_DISPLAY_CODE_POINTS_V1 = 256;
export const MAX_ASSERTION_JSON_DEPTH_V1 = 8;
export const MAX_ASSERTION_JSON_OBJECT_KEYS_V1 = 64;
export const MAX_ASSERTION_JSON_ARRAY_ITEMS_V1 = 256;
export const MAX_ASSERTION_STRING_BYTES_V1 = 8 * 1_024;
export const MAX_ASSERTION_DOCUMENT_BYTES_V1 = 4 * 1_024 * 1_024;

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
  return utf8ByteLength(value) <= MAX_ASSERTION_STRING_BYTES_V1;
}

function isDisplayText(value: string): boolean {
  return (
    !CONTROL_CHARACTER.test(value) &&
    codePointLength(value) <= MAX_ASSERTION_DISPLAY_CODE_POINTS_V1
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
  return Object.getPrototypeOf(value) === Object.prototype;
}

function hasAtMostObjectKeys(value: object): boolean {
  return Object.keys(value).length <= MAX_ASSERTION_JSON_OBJECT_KEYS_V1;
}

function hasAtMostArrayItems<Value>(value: readonly Value[]): boolean {
  return value.length <= MAX_ASSERTION_JSON_ARRAY_ITEMS_V1;
}

function isAssertionEntryId(value: string): boolean {
  return ASSERTION_ENTRY_ID.test(value);
}

function isDocumentWithinSizeLimit(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return (
      typeof serialized === "string" &&
      utf8ByteLength(serialized) <= MAX_ASSERTION_DOCUMENT_BYTES_V1
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
    readonly coverage: AssertionCoverageV1;
    readonly limitations: readonly AssertionLimitationV1[];
  },
): boolean {
  const coverage = entry.coverage;
  if (coverage.state === "complete") {
    return entry.limitations.length === 0;
  }
  if (coverage.state !== "partial") return true;
  return entry.limitations.some((limitation) => limitation.kind === coverage.reason);
}

const BoundedJsonStringV1Schema = Schema.String.pipe(
  Schema.filter(isBoundedString, {
    identifier: "AssertionsBoundedJsonString",
    description: "a UTF-8 string no longer than 8 KiB",
  }),
);

const AssertionDisplayTextV1Schema = Schema.String.pipe(
  Schema.filter(isDisplayText, {
    identifier: "AssertionDisplayText",
    description: "text without control characters and at most 256 code points",
  }),
);

const CriterionIdentifierV1Schema = Schema.String.pipe(
  Schema.filter(isAsciiIdentifier, {
    identifier: "AssertionCriterionIdentifier",
    description: "a non-empty printable ASCII identifier no longer than 128 bytes",
  }),
);

const NonNegativeIntegerV1Schema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeInteger, {
    identifier: "AssertionNonNegativeInteger",
    description: "a finite non-negative integer",
  }),
);

const NonNegativeNumberV1Schema = Schema.JsonNumber.pipe(
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
): value is BoundedJsonValueV1 {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isBoundedString(value);
  if (typeof value !== "object" || depth >= MAX_ASSERTION_JSON_DEPTH_V1) return false;

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

function isBoundedJsonValue(value: unknown): value is BoundedJsonValueV1 {
  return isBoundedJsonValueAt(value, 0, new WeakSet());
}

function isBoundedJsonObject(value: unknown): value is BoundedJsonObjectV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isBoundedJsonValueAt(value, 0, new WeakSet())
  );
}

export const BoundedJsonValueV1Schema: Schema.Schema<BoundedJsonValueV1> =
  Schema.declare<BoundedJsonValueV1>(isBoundedJsonValue);

export const BoundedJsonObjectV1Schema: Schema.Schema<BoundedJsonObjectV1> =
  Schema.declare<BoundedJsonObjectV1>(isBoundedJsonObject);

export const AssertionEntryIdSchema: Schema.Schema<AssertionEntryId, string> =
  Schema.String.pipe(
    Schema.filter(isAssertionEntryId, {
      identifier: "AssertionEntryId",
      description: "an attachment-local ae_ identifier with 20 lowercase base-36 characters",
    }),
    Schema.brand(ASSERTION_ENTRY_ID_BRAND),
  );

export const AssertionDisplayV1Schema: Schema.Schema<AssertionDisplayV1> =
  Schema.Struct({
    key: Schema.optional(AssertionDisplayTextV1Schema),
    label: Schema.optional(AssertionDisplayTextV1Schema),
    groupPath: Schema.Array(AssertionDisplayTextV1Schema).pipe(
      Schema.filter((groupPath) => groupPath.length <= MAX_ASSERTION_GROUP_DEPTH_V1, {
        identifier: "AssertionDisplayGroupPath",
        description: "a group path no deeper than 16 segments",
      }),
    ),
  });

export const BuiltInCriterionEnvelopeV1Schema: Schema.Schema<BuiltInCriterionEnvelopeV1> =
  Schema.Struct({
    kind: Schema.Literal("builtin"),
    id: CriterionIdentifierV1Schema,
    data: BoundedJsonValueV1Schema,
  });

export const ThirdPartyCriterionV1Schema: Schema.Schema<ThirdPartyCriterionV1> =
  Schema.Struct({
    name: CriterionIdentifierV1Schema,
    schemaId: CriterionIdentifierV1Schema,
    data: BoundedJsonValueV1Schema,
  });

export const CriterionOuterEnvelopeV1Schema: Schema.Schema<CriterionOuterEnvelopeV1> =
  Schema.Union(BuiltInCriterionEnvelopeV1Schema, ThirdPartyCriterionV1Schema);

const ValueMatchCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("value-match/v1"),
  data: Schema.Struct({ subject: Schema.Literal("explicit-value") }),
});

const ScopeStatusCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("scope-status/v1"),
  data: Schema.Struct({
    scope: Schema.Literal("turn", "session", "attempt"),
    assertion: Schema.Literal("succeeded", "no-failed-actions"),
  }),
});

const OccurrenceCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("occurrence/v1"),
  data: Schema.Struct({
    scope: Schema.Literal("turn", "session", "attempt"),
    occurrence: Schema.Literal("tool", "skill", "event"),
    assertion: Schema.Literal("present", "absent", "count"),
  }),
});

const JudgeMeasurementCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("judge-measurement/v1"),
  data: Schema.Struct({
    recipe: Schema.Literal("closed-qa", "factuality", "summarizes"),
    scale: Schema.Literal("unit-interval"),
  }),
});

const SandboxResultCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("sandbox-result/v1"),
  data: Schema.Struct({
    operation: Schema.Literal("command", "path", "file", "diff", "usage"),
  }),
});

const DirectScoreCriterionV1Schema = Schema.Struct({
  kind: Schema.Literal("builtin"),
  id: Schema.Literal("direct-score/v1"),
  data: Schema.Struct({ source: Schema.Literal("author") }),
});

export const BuiltInCriterionV1Schema: Schema.Schema<BuiltInCriterionV1> =
  Schema.Union(
    ValueMatchCriterionV1Schema,
    ScopeStatusCriterionV1Schema,
    OccurrenceCriterionV1Schema,
    JudgeMeasurementCriterionV1Schema,
    SandboxResultCriterionV1Schema,
    DirectScoreCriterionV1Schema,
  );

export const CriterionEnvelopeV1Schema: Schema.Schema<WritableCriterionEnvelopeV1> =
  Schema.Union(BuiltInCriterionV1Schema, ThirdPartyCriterionV1Schema);

export const AssertionCoverageV1Schema: Schema.Schema<AssertionCoverageV1> =
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

export const AssertionLimitationV1Schema: Schema.Schema<AssertionLimitationV1> =
  Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("redacted"),
      fieldCount: NonNegativeIntegerV1Schema,
    }),
    Schema.Struct({
      kind: Schema.Literal("sampled"),
      captured: NonNegativeIntegerV1Schema,
      knownTotal: Schema.optional(NonNegativeIntegerV1Schema),
    }),
    Schema.Struct({
      kind: Schema.Literal("truncated"),
      omittedBytes: NonNegativeIntegerV1Schema,
    }),
    Schema.Struct({ kind: Schema.Literal("provider-limited") }),
  );

const NoScoreContributionV1Schema: Schema.Schema<NoScoreContributionV1> =
  Schema.Struct({ state: Schema.Literal("not-scored") });

const EarnedScoreContributionV1Schema: Schema.Schema<EarnedScoreContributionV1> =
  Schema.Struct({
    state: Schema.Literal("earned"),
    points: NonNegativeNumberV1Schema,
    earned: NonNegativeNumberV1Schema,
  }).pipe(
    Schema.filter((score) => score.earned <= score.points, {
      identifier: "AssertionEarnedScore",
      description: "an earned score no greater than its points",
    }),
  );

const UnavailableScoreContributionV1Schema: Schema.Schema<UnavailableScoreContributionV1> =
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    points: NonNegativeNumberV1Schema,
    reason: Schema.Literal("source-unavailable", "evaluation-errored", "not-applicable"),
  });

export const SealedAssertionResultV1Schema: Schema.Schema<SealedAssertionResultV1> =
  Schema.Union(
    Schema.Struct({
      state: Schema.Literal("matched"),
      gate: Schema.Literal("not-gate", "satisfied"),
      score: Schema.Union(NoScoreContributionV1Schema, EarnedScoreContributionV1Schema),
    }),
    Schema.Struct({
      state: Schema.Literal("mismatched"),
      reason: Schema.Literal("condition-not-met"),
      gate: Schema.Literal("not-gate", "failed"),
      score: Schema.Union(NoScoreContributionV1Schema, EarnedScoreContributionV1Schema),
    }),
    Schema.Struct({
      state: Schema.Literal("unavailable"),
      reason: Schema.Literal("evidence-unavailable", "source-unavailable", "redacted"),
      gate: Schema.Literal("not-gate", "unavailable"),
      score: Schema.Union(NoScoreContributionV1Schema, UnavailableScoreContributionV1Schema),
    }),
    Schema.Struct({
      state: Schema.Literal("errored"),
      reason: Schema.Literal("evaluator-failed", "producer-interrupted", "invalid-subject"),
      gate: Schema.Literal("not-gate", "unavailable"),
      score: Schema.Union(NoScoreContributionV1Schema, UnavailableScoreContributionV1Schema),
    }),
    Schema.Struct({
      state: Schema.Literal("not-applicable"),
      reason: Schema.Literal("coverage-not-applicable"),
      gate: Schema.Literal("not-gate", "not-applicable"),
      score: Schema.Union(NoScoreContributionV1Schema, UnavailableScoreContributionV1Schema),
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
      value: BoundedJsonValueV1Schema,
    }),
    Schema.Struct({
      kind: Schema.Literal("blob"),
      ref: blobRefSchema,
      encoding: Schema.Literal("utf-8", "binary"),
      byteLength: NonNegativeIntegerV1Schema,
      preview: BoundedJsonStringV1Schema,
    }),
  );

  const evidence = Schema.Array(material);
  const limitations = Schema.Array(AssertionLimitationV1Schema);

  const outerEntry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplayV1Schema,
    criterion: BoundedJsonObjectV1Schema,
    subject: material,
    evidence,
    coverage: AssertionCoverageV1Schema,
    limitations,
    result: SealedAssertionResultV1Schema,
  }).pipe(
    Schema.filter(hasCoverageConsistentLimitations, {
      identifier: "AssertionCoverageLimitations",
      description: "coverage and limitations with a consistent sealed relationship",
    }),
  );

  const outerDocument = Schema.Struct({
    entries: Schema.Array(outerEntry).pipe(
      Schema.filter((entries) => entries.length <= MAX_ASSERTION_ENTRIES_V1, {
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

  const entry = Schema.Struct({
    entryId: AssertionEntryIdSchema,
    display: AssertionDisplayV1Schema,
    criterion: CriterionEnvelopeV1Schema,
    subject: material,
    evidence,
    coverage: AssertionCoverageV1Schema,
    limitations,
    result: SealedAssertionResultV1Schema,
  }).pipe(
    Schema.filter(hasCoverageConsistentLimitations, {
      identifier: "AssertionCoverageLimitations",
      description: "coverage and limitations with a consistent sealed relationship",
    }),
  );

  const document = Schema.Struct({
    entries: Schema.Array(entry).pipe(
      Schema.filter((entries) => entries.length <= MAX_ASSERTION_ENTRIES_V1, {
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

  return Object.freeze({ material, outerDocument, document });
}

export interface AssertionsRecordCodecError {
  readonly code: "assertions-document-invalid";
}

const assertionsDocumentInvalid: AssertionsRecordCodecError = Object.freeze({
  code: "assertions-document-invalid",
});

export function decodeAssertionsDocumentOuterV1<BlobRef, Encoded>(
  schema: Schema.Schema<AssertionsDocumentOuterV1<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<AssertionsDocumentOuterV1<BlobRef>, AssertionsRecordCodecError> {
  const decoded = Schema.decodeUnknownEither(
    schema,
    AssertionsExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionsDocumentInvalid)
    : Either.right(decoded.right);
}

export function decodeAssertionsDocumentV1<BlobRef, Encoded>(
  schema: Schema.Schema<AssertionsDocumentV1<BlobRef>, Encoded>,
  input: unknown,
): Either.Either<AssertionsDocumentV1<BlobRef>, AssertionsRecordCodecError> {
  const decoded = Schema.decodeUnknownEither(
    schema,
    AssertionsExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(assertionsDocumentInvalid)
    : Either.right(decoded.right);
}

export interface ThirdPartyCriterionDefinitionV1 {
  readonly name: string;
  readonly schemaId: string;
  readonly dataSchema: Schema.Schema.AnyNoContext;
}

export interface ThirdPartyCriterionRegistryV1 {
  readonly lookup: (
    name: string,
    schemaId: string,
  ) => ThirdPartyCriterionDefinitionV1 | undefined;
}

export type ThirdPartyCriterionRegistryErrorV1 =
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

export function makeThirdPartyCriterionRegistryV1(
  definitions: readonly ThirdPartyCriterionDefinitionV1[],
): Either.Either<ThirdPartyCriterionRegistryV1, ThirdPartyCriterionRegistryErrorV1> {
  const byIdentity = new Map<string, ThirdPartyCriterionDefinitionV1>();
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
  entry: AssertionEntryOuterV1<BlobRef>,
  criterion: WritableCriterionEnvelopeV1,
): AssertionEntryReadV1<BlobRef> {
  const available: AssertionEntryV1<BlobRef> = {
    ...entry,
    criterion,
  };
  return Object.freeze({ state: "available", entry: Object.freeze(available) });
}

function projectAssertionEntryV1<BlobRef>(
  entry: AssertionEntryOuterV1<BlobRef>,
  registry: ThirdPartyCriterionRegistryV1,
): AssertionEntryReadV1<BlobRef> {
  const builtinEnvelope = Schema.decodeUnknownEither(
    BuiltInCriterionEnvelopeV1Schema,
    AssertionsExactParseOptions,
  )(entry.criterion);
  if (Either.isRight(builtinEnvelope)) {
    const builtin = Schema.decodeUnknownEither(
      BuiltInCriterionV1Schema,
      AssertionsExactParseOptions,
    )(entry.criterion);
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
    ThirdPartyCriterionV1Schema,
    AssertionsExactParseOptions,
  )(entry.criterion);
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
export function projectAssertionsDocumentV1<BlobRef>(
  document: AssertionsDocumentOuterV1<BlobRef>,
  registry: ThirdPartyCriterionRegistryV1,
): AssertionsProjectionV1<BlobRef> {
  return Object.freeze({
    entries: Object.freeze(
      document.entries.map((entry) => projectAssertionEntryV1(entry, registry)),
    ),
  });
}
