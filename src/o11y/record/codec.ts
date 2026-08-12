import { Schema } from "effect";
import {
  CANONICAL_DECIMAL_V1_BRAND,
  CALL_ID_V1_BRAND,
  COMMAND_ID_V1_BRAND,
  CURRENCY_CODE_V1_BRAND,
  DIAGNOSTIC_ID_V1_BRAND,
  INTERVAL_ID_V1_BRAND,
  ITEM_ID_V1_BRAND,
  NON_NEGATIVE_SAFE_INTEGER_V1_BRAND,
  POSITIVE_SAFE_INTEGER_V1_BRAND,
  SAFE_IDENTIFIER_V1_BRAND,
  SAFE_TEXT_V1_BRAND,
  STABLE_LABEL_V1_BRAND,
  TURN_ID_V1_BRAND,
  USAGE_OBSERVATION_ID_V1_BRAND,
  isBoundedSafeTextV1,
  isCallIdV1,
  isCanonicalDecimalV1,
  isCollectionStageV1,
  isCollectionTargetV1,
  isCommandIdV1,
  isCurrencyCodeV1,
  isDiagnosticIdV1,
  isIntervalIdV1,
  isItemIdV1,
  isNonNegativeSafeIntegerV1,
  isPositiveSafeIntegerV1,
  isSafeIdentifierV1,
  isSafeTextV1,
  isStableLabelV1,
  isTurnIdV1,
  isUsageObservationIdV1,
  isObservabilityLimitationV1,
  isCanonicalAttemptReferencesV1 as canonicalAttemptReferencesV1,
  isCanonicalRunReferencesV1 as canonicalRunReferencesV1,
  validateObservabilityCollectionV1,
  type AttemptDiagnosticsReferencesV1,
  type AttemptTimingReferencesV1,
  type CanonicalDecimal,
  type CallIdV1,
  type CommandIdV1,
  type CommandsReferencesV1,
  type ConversationReferencesV1,
  type CurrencyCode,
  type DiagnosticIdV1,
  type IntervalIdV1,
  type ItemIdV1,
  type NonNegativeSafeInteger,
  type PositiveSafeInteger,
  type RunDiagnosticsReferencesV1,
  type RunTimingReferencesV1,
  type SafeIdentifier,
  type SafeText,
  type StableLabel,
  type TurnIdV1,
  type UsageObservationIdV1,
  type UsageReferencesV1,
} from "./model.ts";
import { MAX_DIRECT_CROSS_FAMILY_REFS_V1 } from "./limits.ts";

/** All official Observability schemas aggregate failures and reject extra fields. */
export const ObservabilityExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export const ObservabilityExactParseOptionsV1 = ObservabilityExactParseOptions;

export const NonNegativeSafeIntegerV1Schema: Schema.Schema<
  NonNegativeSafeInteger,
  number
> = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeSafeIntegerV1, {
    identifier: "ObservabilityNonNegativeSafeIntegerV1",
    description: "a JSON-safe non-negative integer",
  }),
  Schema.brand(NON_NEGATIVE_SAFE_INTEGER_V1_BRAND),
);

export const PositiveSafeIntegerV1Schema: Schema.Schema<PositiveSafeInteger, number> =
  Schema.JsonNumber.pipe(
    Schema.filter(isPositiveSafeIntegerV1, {
      identifier: "ObservabilityPositiveSafeIntegerV1",
      description: "a positive JSON-safe integer",
    }),
    Schema.brand(POSITIVE_SAFE_INTEGER_V1_BRAND),
  );

export const SafeIdentifierV1Schema: Schema.Schema<SafeIdentifier, string> =
  Schema.String.pipe(
    Schema.filter(isSafeIdentifierV1, {
      identifier: "ObservabilitySafeIdentifierV1",
      description: "a lowercase ASCII identifier no longer than 64 bytes",
    }),
    Schema.brand(SAFE_IDENTIFIER_V1_BRAND),
  );

export const StableLabelV1Schema: Schema.Schema<StableLabel, string> = Schema.String.pipe(
  Schema.filter(isStableLabelV1, {
    identifier: "ObservabilityStableLabelV1",
    description: "a provider-neutral lowercase ASCII label no longer than 64 bytes",
  }),
  Schema.brand(STABLE_LABEL_V1_BRAND),
);

export const SafeTextV1Schema: Schema.Schema<SafeText, string> = Schema.String.pipe(
  Schema.filter(isSafeTextV1, {
    identifier: "ObservabilitySafeTextV1",
    description: "strict UTF-8 text without NUL or C0 controls other than LF",
  }),
  Schema.brand(SAFE_TEXT_V1_BRAND),
);

/** A SafeText field whose maximum is part of its owning family contract. */
export function boundedSafeTextV1Schema(maximumBytes: number) {
  return Schema.String.pipe(
    Schema.filter((value): value is SafeText => isBoundedSafeTextV1(value, maximumBytes), {
      identifier: "ObservabilityBoundedSafeTextV1",
      description: `strict UTF-8 SafeText no longer than ${maximumBytes} bytes`,
    }),
    Schema.brand(SAFE_TEXT_V1_BRAND),
  );
}

export const CanonicalDecimalV1Schema: Schema.Schema<CanonicalDecimal, string> =
  Schema.String.pipe(
    Schema.filter(isCanonicalDecimalV1, {
      identifier: "ObservabilityCanonicalDecimalV1",
      description: "a non-negative canonical decimal string no longer than 64 bytes",
    }),
    Schema.brand(CANONICAL_DECIMAL_V1_BRAND),
  );

export const CurrencyCodeV1Schema: Schema.Schema<CurrencyCode, string> = Schema.String.pipe(
  Schema.filter(isCurrencyCodeV1, {
    identifier: "ObservabilityCurrencyCodeV1",
    description: "an uppercase three-letter currency code",
  }),
  Schema.brand(CURRENCY_CODE_V1_BRAND),
);

export const TurnIdV1Schema: Schema.Schema<TurnIdV1, string> = Schema.String.pipe(
  Schema.filter(isTurnIdV1, {
    identifier: "ObservabilityTurnIdV1",
    description: "a turn_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(TURN_ID_V1_BRAND),
);

export const ItemIdV1Schema: Schema.Schema<ItemIdV1, string> = Schema.String.pipe(
  Schema.filter(isItemIdV1, {
    identifier: "ObservabilityItemIdV1",
    description: "an item_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(ITEM_ID_V1_BRAND),
);

export const CallIdV1Schema: Schema.Schema<CallIdV1, string> = Schema.String.pipe(
  Schema.filter(isCallIdV1, {
    identifier: "ObservabilityCallIdV1",
    description: "a call_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(CALL_ID_V1_BRAND),
);

export const CommandIdV1Schema: Schema.Schema<CommandIdV1, string> = Schema.String.pipe(
  Schema.filter(isCommandIdV1, {
    identifier: "ObservabilityCommandIdV1",
    description: "a command_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(COMMAND_ID_V1_BRAND),
);

export const UsageObservationIdV1Schema: Schema.Schema<
  UsageObservationIdV1,
  string
> = Schema.String.pipe(
  Schema.filter(isUsageObservationIdV1, {
    identifier: "ObservabilityUsageObservationIdV1",
    description: "a usage_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(USAGE_OBSERVATION_ID_V1_BRAND),
);

export const IntervalIdV1Schema: Schema.Schema<IntervalIdV1, string> = Schema.String.pipe(
  Schema.filter(isIntervalIdV1, {
    identifier: "ObservabilityIntervalIdV1",
    description: "an interval_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(INTERVAL_ID_V1_BRAND),
);

export const DiagnosticIdV1Schema: Schema.Schema<DiagnosticIdV1, string> =
  Schema.String.pipe(
    Schema.filter(isDiagnosticIdV1, {
      identifier: "ObservabilityDiagnosticIdV1",
      description: "a diagnostic_ identifier with 26 lowercase Crockford base-32 characters",
    }),
    Schema.brand(DIAGNOSTIC_ID_V1_BRAND),
  );

export const CollectionTargetV1Schema = Schema.Literal(
  "conversation-item",
  "conversation-text",
  "command-manifest",
  "command-stdout",
  "command-stderr",
  "usage-observation",
  "timing-interval",
  "diagnostic",
).pipe(
  Schema.filter(isCollectionTargetV1, {
    identifier: "ObservabilityCollectionTargetV1",
    description: "a closed Observability collection target",
  }),
);

export const CollectionStageV1Schema = Schema.Literal(
  "adapter",
  "command-capture",
  "usage-capture",
  "timing-capture",
  "diagnostic-capture",
  "attempt-finalizer",
  "run-teardown",
).pipe(
  Schema.filter(isCollectionStageV1, {
    identifier: "ObservabilityCollectionStageV1",
    description: "a closed Observability capture stage",
  }),
);

const CaptureFailedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("capture-failed"),
  stage: CollectionStageV1Schema,
  target: CollectionTargetV1Schema,
});

const CaptureInterruptedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("capture-interrupted"),
  stage: CollectionStageV1Schema,
  target: CollectionTargetV1Schema,
});

const CollectionCapReachedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("collection-cap-reached"),
  target: CollectionTargetV1Schema,
  retained: NonNegativeSafeIntegerV1Schema,
  omittedAtLeast: PositiveSafeIntegerV1Schema,
});

const UnsupportedInputLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("unsupported-input"),
  target: CollectionTargetV1Schema,
  omittedAtLeast: PositiveSafeIntegerV1Schema,
});

const ConversationTextTruncatedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("conversation-text"),
  itemId: ItemIdV1Schema,
  retainedBytes: NonNegativeSafeIntegerV1Schema,
  omittedBytes: PositiveSafeIntegerV1Schema,
});

const CommandManifestTextTruncatedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("command-manifest"),
  commandId: CommandIdV1Schema,
  retainedBytes: NonNegativeSafeIntegerV1Schema,
  omittedBytes: PositiveSafeIntegerV1Schema,
});

const DiagnosticTextTruncatedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("diagnostic"),
  diagnosticId: DiagnosticIdV1Schema,
  retainedBytes: NonNegativeSafeIntegerV1Schema,
  omittedBytes: PositiveSafeIntegerV1Schema,
});

const CommandStreamTruncatedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("stream-truncated"),
  commandId: CommandIdV1Schema,
  stream: Schema.Literal("stdout", "stderr"),
  retainedBytes: NonNegativeSafeIntegerV1Schema,
  omittedBytes: PositiveSafeIntegerV1Schema,
});

const InvalidUtf8ReplacedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("invalid-utf8-replaced"),
  commandId: CommandIdV1Schema,
  stream: Schema.Literal("stdout", "stderr"),
  replacementCount: PositiveSafeIntegerV1Schema,
});

const UnsafeControlStrippedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("unsafe-control-stripped"),
  commandId: CommandIdV1Schema,
  stream: Schema.Literal("stdout", "stderr"),
  strippedCount: PositiveSafeIntegerV1Schema,
});

const RedactedLimitationV1Schema = Schema.Struct({
  code: Schema.Literal("redacted"),
  target: CollectionTargetV1Schema,
  replacementCount: PositiveSafeIntegerV1Schema,
});

export const ObservabilityLimitationV1Schema = Schema.Union(
    CaptureFailedLimitationV1Schema,
    CaptureInterruptedLimitationV1Schema,
    CollectionCapReachedLimitationV1Schema,
    UnsupportedInputLimitationV1Schema,
    ConversationTextTruncatedLimitationV1Schema,
    CommandManifestTextTruncatedLimitationV1Schema,
    DiagnosticTextTruncatedLimitationV1Schema,
    CommandStreamTruncatedLimitationV1Schema,
    InvalidUtf8ReplacedLimitationV1Schema,
    UnsafeControlStrippedLimitationV1Schema,
    RedactedLimitationV1Schema,
  ).pipe(
    Schema.filter(isObservabilityLimitationV1, {
      identifier: "ObservabilityLimitationV1",
      description: "a semantically valid closed Observability limitation",
    }),
  );

const CompleteCollectionV1Schema = Schema.Struct({
  state: Schema.Literal("complete"),
  limitations: Schema.Tuple(),
});

const PartialCollectionV1Schema = Schema.Struct({
  state: Schema.Literal("partial"),
  limitations: Schema.NonEmptyArray(ObservabilityLimitationV1Schema),
});

export const CollectionV1Schema = Schema.Union(
  CompleteCollectionV1Schema,
  PartialCollectionV1Schema,
).pipe(
  Schema.filter((collection) => validateObservabilityCollectionV1(collection).length === 0, {
    identifier: "ObservabilityCollectionV1",
    description: "a complete empty or partial canonically ordered limitation collection",
  }),
);

const ConversationTurnReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.conversation/v1"),
  kind: Schema.Literal("turn"),
  id: TurnIdV1Schema,
});

const ConversationItemReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.conversation/v1"),
  kind: Schema.Literal("item"),
  id: ItemIdV1Schema,
});

const ConversationCallReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.conversation/v1"),
  kind: Schema.Literal("call"),
  id: CallIdV1Schema,
});

const CommandReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.commands/v1"),
  kind: Schema.Literal("command"),
  id: CommandIdV1Schema,
});

const UsageObservationReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.usage/v1"),
  kind: Schema.Literal("usage-observation"),
  id: UsageObservationIdV1Schema,
});

const IntervalReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.timing/v1"),
  kind: Schema.Literal("interval"),
  id: IntervalIdV1Schema,
});

const DiagnosticReferenceTargetV1Schema = Schema.Struct({
  family: Schema.Literal("niceeval.diagnostics/v1"),
  kind: Schema.Literal("diagnostic"),
  id: DiagnosticIdV1Schema,
});

export const AttemptReferenceTargetV1Schema = Schema.Union(
    ConversationTurnReferenceTargetV1Schema,
    ConversationItemReferenceTargetV1Schema,
    ConversationCallReferenceTargetV1Schema,
    CommandReferenceTargetV1Schema,
    UsageObservationReferenceTargetV1Schema,
    IntervalReferenceTargetV1Schema,
    DiagnosticReferenceTargetV1Schema,
  );

export const RunReferenceTargetV1Schema = Schema.Union(
  IntervalReferenceTargetV1Schema,
  DiagnosticReferenceTargetV1Schema,
);

export const ConversationReferencesV1Schema = Schema.Array(
  AttemptReferenceTargetV1Schema,
).pipe(
  Schema.filter((refs): refs is readonly ConversationReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalAttemptReferencesV1(refs, "niceeval.conversation/v1"),
  ),
);

export const CommandsReferencesV1Schema = Schema.Array(AttemptReferenceTargetV1Schema).pipe(
  Schema.filter((refs): refs is readonly CommandsReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalAttemptReferencesV1(refs, "niceeval.commands/v1"),
  ),
);

export const UsageReferencesV1Schema = Schema.Array(AttemptReferenceTargetV1Schema).pipe(
  Schema.filter((refs): refs is readonly UsageReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalAttemptReferencesV1(refs, "niceeval.usage/v1"),
  ),
);

export const AttemptTimingReferencesV1Schema = Schema.Array(
  AttemptReferenceTargetV1Schema,
).pipe(
  Schema.filter((refs): refs is readonly AttemptTimingReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalAttemptReferencesV1(refs, "niceeval.timing/v1"),
  ),
);

export const AttemptDiagnosticsReferencesV1Schema = Schema.Array(
  AttemptReferenceTargetV1Schema,
).pipe(
  Schema.filter((refs): refs is readonly AttemptDiagnosticsReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalAttemptReferencesV1(refs, "niceeval.diagnostics/v1"),
  ),
);

export const RunTimingReferencesV1Schema = Schema.Array(RunReferenceTargetV1Schema).pipe(
  Schema.filter((refs): refs is readonly RunTimingReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalRunReferencesV1(refs, "niceeval.timing/v1"),
  ),
);

export const RunDiagnosticsReferencesV1Schema = Schema.Array(
  RunReferenceTargetV1Schema,
).pipe(
  Schema.filter((refs): refs is readonly RunDiagnosticsReferencesV1[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS_V1 &&
    canonicalRunReferencesV1(refs, "niceeval.diagnostics/v1"),
  ),
);
