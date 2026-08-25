import { Schema } from "effect";
import {
  CANONICAL_DECIMAL__BRAND,
  CALL_ID__BRAND,
  COMMAND_ID__BRAND,
  CURRENCY_CODE__BRAND,
  DIAGNOSTIC_ID__BRAND,
  EVENT_ID__BRAND,
  INTERVAL_ID__BRAND,
  ITEM_ID__BRAND,
  LEGACY_SOURCE_LOCAL_CALL_ID__BRAND,
  NON_NEGATIVE_SAFE_INTEGER__BRAND,
  POSITIVE_SAFE_INTEGER__BRAND,
  SAFE_IDENTIFIER__BRAND,
  SAFE_TEXT__BRAND,
  SOURCE_NATIVE_TOOL_NAME__BRAND,
  STABLE_LABEL__BRAND,
  SESSION_SCOPE_ID__BRAND,
  TOOL_OCCURRENCE_ID__BRAND,
  TURN_ID__BRAND,
  USAGE_OBSERVATION_ID__BRAND,
  isBoundedSafeText,
  isCallId,
  isCanonicalDecimal,
  isCollectionStage,
  isCollectionTarget,
  isCommandId,
  isCurrencyCode,
  isDiagnosticId,
  isEventId,
  isIntervalId,
  isItemId,
  isLegacySourceLocalCallId,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isSafeIdentifier,
  isSafeText,
  isSourceNativeToolName,
  isStableLabel,
  isSessionScopeId,
  isToolOccurrenceId,
  isTurnId,
  isUsageObservationId,
  isObservabilityLimitation,
  isCanonicalAttemptReferences as canonicalAttemptReferences,
  isCanonicalRunReferences as canonicalRunReferences,
  validateObservabilityCollection,
  type AttemptDiagnosticsReferences,
  type AttemptTimingReferences,
  type CanonicalDecimal,
  type CallId,
  type CommandId,
  type CommandsReferences,
  type ConversationReferences,
  type CurrencyCode,
  type DiagnosticId,
  type EventId,
  type IntervalId,
  type ItemId,
  type LegacySourceLocalCallId,
  type NonNegativeSafeInteger,
  type PositiveSafeInteger,
  type RunDiagnosticsReferences,
  type RunTimingReferences,
  type SafeIdentifier,
  type SafeText,
  type SourceNativeToolName,
  type StableLabel,
  type SessionScopeId,
  type ToolOccurrenceId,
  type TurnId,
  type UsageObservationId,
  type UsageReferences,
} from "./model.ts";
import {
  MAX_DIRECT_CROSS_FAMILY_REFS,
  MAX_SOURCE_NATIVE_TOOL_NAME_BYTES,
} from "./limits.ts";

/** All official Observability schemas aggregate failures and reject extra fields. */
export const ObservabilityExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});


export const NonNegativeSafeIntegerSchema: Schema.Schema<
  NonNegativeSafeInteger,
  number
> = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeSafeInteger, {
    identifier: "ObservabilityNonNegativeSafeInteger",
    description: "a JSON-safe non-negative integer",
  }),
  Schema.brand(NON_NEGATIVE_SAFE_INTEGER__BRAND),
);

export const PositiveSafeIntegerSchema: Schema.Schema<PositiveSafeInteger, number> =
  Schema.JsonNumber.pipe(
    Schema.filter(isPositiveSafeInteger, {
      identifier: "ObservabilityPositiveSafeInteger",
      description: "a positive JSON-safe integer",
    }),
    Schema.brand(POSITIVE_SAFE_INTEGER__BRAND),
  );

export const SafeIdentifierSchema: Schema.Schema<SafeIdentifier, string> =
  Schema.String.pipe(
    Schema.filter(isSafeIdentifier, {
      identifier: "ObservabilitySafeIdentifier",
      description: "a lowercase ASCII identifier no longer than 64 bytes",
    }),
    Schema.brand(SAFE_IDENTIFIER__BRAND),
  );

export const StableLabelSchema: Schema.Schema<StableLabel, string> = Schema.String.pipe(
  Schema.filter(isStableLabel, {
    identifier: "ObservabilityStableLabel",
    description: "a provider-neutral lowercase ASCII label no longer than 64 bytes",
  }),
  Schema.brand(STABLE_LABEL__BRAND),
);

export const SafeTextSchema: Schema.Schema<SafeText, string> = Schema.String.pipe(
  Schema.filter(isSafeText, {
    identifier: "ObservabilitySafeText",
    description: "strict UTF-8 text without NUL or C0 controls other than LF",
  }),
  Schema.brand(SAFE_TEXT__BRAND),
);

export const SourceNativeToolNameSchema: Schema.Schema<
  SourceNativeToolName,
  string
> = Schema.String.pipe(
  Schema.filter(isSourceNativeToolName, {
    identifier: "ObservabilitySourceNativeToolName",
    description:
      `a non-empty source-native tool name no longer than ${MAX_SOURCE_NATIVE_TOOL_NAME_BYTES} UTF-8 bytes`,
  }),
  Schema.brand(SOURCE_NATIVE_TOOL_NAME__BRAND),
);

/** A SafeText field whose maximum is part of its owning family contract. */
export function boundedSafeTextSchema(maximumBytes: number) {
  return Schema.String.pipe(
    Schema.filter((value): value is SafeText => isBoundedSafeText(value, maximumBytes), {
      identifier: "ObservabilityBoundedSafeText",
      description: `strict UTF-8 SafeText no longer than ${maximumBytes} bytes`,
    }),
    Schema.brand(SAFE_TEXT__BRAND),
  );
}

export const CanonicalDecimalSchema: Schema.Schema<CanonicalDecimal, string> =
  Schema.String.pipe(
    Schema.filter(isCanonicalDecimal, {
      identifier: "ObservabilityCanonicalDecimal",
      description: "a non-negative canonical decimal string no longer than 64 bytes",
    }),
    Schema.brand(CANONICAL_DECIMAL__BRAND),
  );

export const CurrencyCodeSchema: Schema.Schema<CurrencyCode, string> = Schema.String.pipe(
  Schema.filter(isCurrencyCode, {
    identifier: "ObservabilityCurrencyCode",
    description: "an uppercase three-letter currency code",
  }),
  Schema.brand(CURRENCY_CODE__BRAND),
);

export const TurnIdSchema: Schema.Schema<TurnId, string> = Schema.String.pipe(
  Schema.filter(isTurnId, {
    identifier: "ObservabilityTurnId",
    description: "a turn_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(TURN_ID__BRAND),
);

export const ItemIdSchema: Schema.Schema<ItemId, string> = Schema.String.pipe(
  Schema.filter(isItemId, {
    identifier: "ObservabilityItemId",
    description: "an item_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(ITEM_ID__BRAND),
);

export const CallIdSchema: Schema.Schema<CallId, string> = Schema.String.pipe(
  Schema.filter(isCallId, {
    identifier: "ObservabilityCallId",
    description: "a call_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(CALL_ID__BRAND),
);

export const LegacySourceLocalCallIdSchema: Schema.Schema<
  LegacySourceLocalCallId,
  string
> = Schema.String.pipe(
  Schema.filter(isLegacySourceLocalCallId, {
    identifier: "ObservabilityLegacySourceLocalCallId",
    description: "a v1 source-local call identifier",
  }),
  Schema.brand(LEGACY_SOURCE_LOCAL_CALL_ID__BRAND),
);

export const EventIdSchema: Schema.Schema<EventId, string> = Schema.String.pipe(
  Schema.filter(isEventId, {
    identifier: "ObservabilityEventId",
    description: "an event_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(EVENT_ID__BRAND),
);

export const ToolOccurrenceIdSchema: Schema.Schema<ToolOccurrenceId, string> =
  Schema.String.pipe(
    Schema.filter(isToolOccurrenceId, {
      identifier: "ObservabilityToolOccurrenceId",
      description: "a tool_ identifier with 26 lowercase Crockford base-32 characters",
    }),
    Schema.brand(TOOL_OCCURRENCE_ID__BRAND),
  );

export const SessionScopeIdSchema: Schema.Schema<SessionScopeId, string> =
  Schema.String.pipe(
    Schema.filter(isSessionScopeId, {
      identifier: "ObservabilitySessionScopeId",
      description: "a session_ identifier with 26 lowercase Crockford base-32 characters",
    }),
    Schema.brand(SESSION_SCOPE_ID__BRAND),
  );

export const CommandIdSchema: Schema.Schema<CommandId, string> = Schema.String.pipe(
  Schema.filter(isCommandId, {
    identifier: "ObservabilityCommandId",
    description: "a command_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(COMMAND_ID__BRAND),
);

export const UsageObservationIdSchema: Schema.Schema<
  UsageObservationId,
  string
> = Schema.String.pipe(
  Schema.filter(isUsageObservationId, {
    identifier: "ObservabilityUsageObservationId",
    description: "a usage_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(USAGE_OBSERVATION_ID__BRAND),
);

export const IntervalIdSchema: Schema.Schema<IntervalId, string> = Schema.String.pipe(
  Schema.filter(isIntervalId, {
    identifier: "ObservabilityIntervalId",
    description: "an interval_ identifier with 26 lowercase Crockford base-32 characters",
  }),
  Schema.brand(INTERVAL_ID__BRAND),
);

export const DiagnosticIdSchema: Schema.Schema<DiagnosticId, string> =
  Schema.String.pipe(
    Schema.filter(isDiagnosticId, {
      identifier: "ObservabilityDiagnosticId",
      description: "a diagnostic_ identifier with 26 lowercase Crockford base-32 characters",
    }),
    Schema.brand(DIAGNOSTIC_ID__BRAND),
  );

export const CollectionTargetSchema = Schema.Literal(
  "conversation-item",
  "conversation-text",
  "command-manifest",
  "command-stdout",
  "command-stderr",
  "usage-observation",
  "timing-interval",
  "diagnostic",
).pipe(
  Schema.filter(isCollectionTarget, {
    identifier: "ObservabilityCollectionTarget",
    description: "a closed Observability collection target",
  }),
);

export const CollectionStageSchema = Schema.Literal(
  "adapter",
  "command-capture",
  "usage-capture",
  "timing-capture",
  "diagnostic-capture",
  "attempt-finalizer",
  "run-teardown",
).pipe(
  Schema.filter(isCollectionStage, {
    identifier: "ObservabilityCollectionStage",
    description: "a closed Observability capture stage",
  }),
);

const CaptureFailedLimitationSchema = Schema.Struct({
  code: Schema.Literal("capture-failed"),
  stage: CollectionStageSchema,
  target: CollectionTargetSchema,
});

const CaptureInterruptedLimitationSchema = Schema.Struct({
  code: Schema.Literal("capture-interrupted"),
  stage: CollectionStageSchema,
  target: CollectionTargetSchema,
});

const CollectionCapReachedLimitationSchema = Schema.Struct({
  code: Schema.Literal("collection-cap-reached"),
  target: CollectionTargetSchema,
  retained: NonNegativeSafeIntegerSchema,
  omittedAtLeast: PositiveSafeIntegerSchema,
});

const UnsupportedInputLimitationSchema = Schema.Struct({
  code: Schema.Literal("unsupported-input"),
  target: CollectionTargetSchema,
  omittedAtLeast: PositiveSafeIntegerSchema,
});

const ConversationTextTruncatedLimitationSchema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("conversation-text"),
  itemId: ItemIdSchema,
  retainedBytes: NonNegativeSafeIntegerSchema,
  omittedBytes: PositiveSafeIntegerSchema,
});

const CommandManifestTextTruncatedLimitationSchema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("command-manifest"),
  commandId: CommandIdSchema,
  retainedBytes: NonNegativeSafeIntegerSchema,
  omittedBytes: PositiveSafeIntegerSchema,
});

const DiagnosticTextTruncatedLimitationSchema = Schema.Struct({
  code: Schema.Literal("text-truncated"),
  target: Schema.Literal("diagnostic"),
  diagnosticId: DiagnosticIdSchema,
  retainedBytes: NonNegativeSafeIntegerSchema,
  omittedBytes: PositiveSafeIntegerSchema,
});

const CommandStreamTruncatedLimitationSchema = Schema.Struct({
  code: Schema.Literal("stream-truncated"),
  commandId: CommandIdSchema,
  stream: Schema.Literal("stdout", "stderr"),
  retainedBytes: NonNegativeSafeIntegerSchema,
  omittedBytes: PositiveSafeIntegerSchema,
});

const InvalidUtf8ReplacedLimitationSchema = Schema.Struct({
  code: Schema.Literal("invalid-utf8-replaced"),
  commandId: CommandIdSchema,
  stream: Schema.Literal("stdout", "stderr"),
  replacementCount: PositiveSafeIntegerSchema,
});

const UnsafeControlStrippedLimitationSchema = Schema.Struct({
  code: Schema.Literal("unsafe-control-stripped"),
  commandId: CommandIdSchema,
  stream: Schema.Literal("stdout", "stderr"),
  strippedCount: PositiveSafeIntegerSchema,
});

const RedactedLimitationSchema = Schema.Struct({
  code: Schema.Literal("redacted"),
  target: CollectionTargetSchema,
  replacementCount: PositiveSafeIntegerSchema,
});

export const ObservabilityLimitationSchema = Schema.Union(
    CaptureFailedLimitationSchema,
    CaptureInterruptedLimitationSchema,
    CollectionCapReachedLimitationSchema,
    UnsupportedInputLimitationSchema,
    ConversationTextTruncatedLimitationSchema,
    CommandManifestTextTruncatedLimitationSchema,
    DiagnosticTextTruncatedLimitationSchema,
    CommandStreamTruncatedLimitationSchema,
    InvalidUtf8ReplacedLimitationSchema,
    UnsafeControlStrippedLimitationSchema,
    RedactedLimitationSchema,
  ).pipe(
    Schema.filter(isObservabilityLimitation, {
      identifier: "ObservabilityLimitation",
      description: "a semantically valid closed Observability limitation",
    }),
  );

const CompleteCollectionSchema = Schema.Struct({
  state: Schema.Literal("complete"),
  limitations: Schema.Tuple(),
});

const PartialCollectionSchema = Schema.Struct({
  state: Schema.Literal("partial"),
  limitations: Schema.NonEmptyArray(ObservabilityLimitationSchema),
});

export const CollectionSchema = Schema.Union(
  CompleteCollectionSchema,
  PartialCollectionSchema,
).pipe(
  Schema.filter((collection) => validateObservabilityCollection(collection).length === 0, {
    identifier: "ObservabilityCollection",
    description: "a complete empty or partial canonically ordered limitation collection",
  }),
);

const ConversationTurnReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("turn"),
  id: TurnIdSchema,
});

const ConversationItemReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("item"),
  id: ItemIdSchema,
});

const ConversationCallReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("call"),
  id: CallIdSchema,
});

const ConversationEventReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("event"),
  id: EventIdSchema,
});

const ConversationToolOccurrenceReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("tool-occurrence"),
  id: ToolOccurrenceIdSchema,
});

const ConversationSessionScopeReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("session-scope"),
  id: SessionScopeIdSchema,
});

const CommandReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.sandbox-commands"),
  kind: Schema.Literal("command"),
  id: CommandIdSchema,
});

const UsageObservationReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.agent-turns"),
  kind: Schema.Literal("usage-observation"),
  id: UsageObservationIdSchema,
});

const IntervalReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.runner-activities"),
  kind: Schema.Literal("interval"),
  id: IntervalIdSchema,
});

const DiagnosticReferenceTargetSchema = Schema.Struct({
  family: Schema.Literal("niceeval.runner-diagnostics"),
  kind: Schema.Literal("diagnostic"),
  id: DiagnosticIdSchema,
});

export const AttemptReferenceTargetSchema = Schema.Union(
    ConversationTurnReferenceTargetSchema,
    ConversationItemReferenceTargetSchema,
    ConversationCallReferenceTargetSchema,
    ConversationEventReferenceTargetSchema,
    ConversationToolOccurrenceReferenceTargetSchema,
    ConversationSessionScopeReferenceTargetSchema,
    CommandReferenceTargetSchema,
    UsageObservationReferenceTargetSchema,
    IntervalReferenceTargetSchema,
    DiagnosticReferenceTargetSchema,
  );

export const RunReferenceTargetSchema = Schema.Union(
  IntervalReferenceTargetSchema,
  DiagnosticReferenceTargetSchema,
);

export const ConversationReferencesSchema = Schema.Array(
  AttemptReferenceTargetSchema,
).pipe(
  Schema.filter((refs): refs is readonly ConversationReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalAttemptReferences(refs, "niceeval.agent-turns"),
  ),
);

export const CommandsReferencesSchema = Schema.Array(AttemptReferenceTargetSchema).pipe(
  Schema.filter((refs): refs is readonly CommandsReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalAttemptReferences(refs, "niceeval.sandbox-commands"),
  ),
);

export const UsageReferencesSchema = Schema.Array(AttemptReferenceTargetSchema).pipe(
  Schema.filter((refs): refs is readonly UsageReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalAttemptReferences(refs, "niceeval.agent-turns"),
  ),
);

export const AttemptTimingReferencesSchema = Schema.Array(
  AttemptReferenceTargetSchema,
).pipe(
  Schema.filter((refs): refs is readonly AttemptTimingReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalAttemptReferences(refs, "niceeval.runner-activities"),
  ),
);

export const AttemptDiagnosticsReferencesSchema = Schema.Array(
  AttemptReferenceTargetSchema,
).pipe(
  Schema.filter((refs): refs is readonly AttemptDiagnosticsReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalAttemptReferences(refs, "niceeval.runner-diagnostics"),
  ),
);

export const RunTimingReferencesSchema = Schema.Array(RunReferenceTargetSchema).pipe(
  Schema.filter((refs): refs is readonly RunTimingReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalRunReferences(refs, "niceeval.runner-activities"),
  ),
);

export const RunDiagnosticsReferencesSchema = Schema.Array(
  RunReferenceTargetSchema,
).pipe(
  Schema.filter((refs): refs is readonly RunDiagnosticsReferences[] =>
    refs.length <= MAX_DIRECT_CROSS_FAMILY_REFS &&
    canonicalRunReferences(refs, "niceeval.runner-diagnostics"),
  ),
);
