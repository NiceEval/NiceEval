import type { Brand } from "effect";
import {
  MAX_CANONICAL_DECIMAL_BYTES,
  MAX_DIRECT_CROSS_FAMILY_REFS,
  MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES,
  MAX_SAFE_IDENTIFIER_BYTES,
  MAX_SOURCE_NATIVE_TOOL_NAME_BYTES,
  MAX_STABLE_LABEL_BYTES,
  OBSERVABILITY_ENTITY_ID_BASE32_LENGTH,
} from "./limits.ts";

/** A readonly non-empty sequence used by durable complete/partial states. */
export type NonEmptyReadonlyArray<Item> = readonly [Item, ...Item[]];

export const NON_NEGATIVE_SAFE_INTEGER__BRAND =
  "@niceeval/o11y/NonNegativeSafeInteger" as const;
export const POSITIVE_SAFE_INTEGER__BRAND =
  "@niceeval/o11y/PositiveSafeInteger" as const;
export const SAFE_IDENTIFIER__BRAND =
  "@niceeval/o11y/SafeIdentifier" as const;
export const SOURCE_NATIVE_TOOL_NAME__BRAND =
  "@niceeval/o11y/SourceNativeToolName" as const;
export const STABLE_LABEL__BRAND =
  "@niceeval/o11y/StableLabel" as const;
export const SAFE_TEXT__BRAND = "@niceeval/o11y/SafeText" as const;
export const CANONICAL_DECIMAL__BRAND =
  "@niceeval/o11y/CanonicalDecimal" as const;
export const CURRENCY_CODE__BRAND = "@niceeval/o11y/CurrencyCode" as const;

export type NonNegativeSafeInteger = number & Brand.Brand<
  typeof NON_NEGATIVE_SAFE_INTEGER__BRAND
>;
export type PositiveSafeInteger = number & Brand.Brand<
  typeof POSITIVE_SAFE_INTEGER__BRAND
>;
export type SafeIdentifier = string & Brand.Brand<typeof SAFE_IDENTIFIER__BRAND>;
export type SourceNativeToolName = string & Brand.Brand<
  typeof SOURCE_NATIVE_TOOL_NAME__BRAND
>;
export type StableLabel = string & Brand.Brand<typeof STABLE_LABEL__BRAND>;
export type SafeText = string & Brand.Brand<typeof SAFE_TEXT__BRAND>;
export type CanonicalDecimal = string & Brand.Brand<
  typeof CANONICAL_DECIMAL__BRAND
>;
export type CurrencyCode = string & Brand.Brand<typeof CURRENCY_CODE__BRAND>;

/** v1 aliases keep field types visibly tied to this durable format. */

const UTF8 = new TextEncoder();
const SAFE_IDENTIFIER = /^[a-z][a-z0-9.-]{0,63}$/;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
/** C0 controls are never durable SafeText except the LF line separator. */
const UNSAFE_SAFE_TEXT_CONTROL = /[\u0000-\u0009\u000B-\u001F]/u;

export function utf8ByteLength(value: string): number {
  return UTF8.encode(value).byteLength;
}

/** JavaScript strings with an unmatched surrogate do not represent UTF-8 text. */
export function isStrictUnicodeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function isNonNegativeSafeInteger(value: number): value is NonNegativeSafeInteger {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveSafeInteger(value: number): value is PositiveSafeInteger {
  return Number.isSafeInteger(value) && value > 0;
}

export function makeNonNegativeSafeInteger(
  value: number,
): NonNegativeSafeInteger | undefined {
  return isNonNegativeSafeInteger(value) ? (value as NonNegativeSafeInteger) : undefined;
}

export function makePositiveSafeInteger(
  value: number,
): PositiveSafeInteger | undefined {
  return isPositiveSafeInteger(value) ? (value as PositiveSafeInteger) : undefined;
}

export function isSafeIdentifier(value: string): value is SafeIdentifier {
  return (
    utf8ByteLength(value) <= MAX_SAFE_IDENTIFIER_BYTES &&
    SAFE_IDENTIFIER.test(value)
  );
}

export function isStableLabel(value: string): value is StableLabel {
  return (
    utf8ByteLength(value) <= MAX_STABLE_LABEL_BYTES &&
    SAFE_IDENTIFIER.test(value)
  );
}

/**
 * A provider's exact tool name. Unlike SafeIdentifier, this durable value is
 * intentionally case-sensitive and admits source-native punctuation and
 * Unicode. Line breaks remain excluded so a name cannot reshape a Report
 * heading while still passing through unchanged.
 */
export function isSourceNativeToolName(
  value: string,
): value is SourceNativeToolName {
  return (
    value.length > 0 &&
    !value.includes("\n") &&
    isBoundedSafeText(value, MAX_SOURCE_NATIVE_TOOL_NAME_BYTES)
  );
}

export function isSafeText(value: string): value is SafeText {
  return isStrictUnicodeText(value) && !UNSAFE_SAFE_TEXT_CONTROL.test(value);
}

export function isBoundedSafeText(
  value: string,
  maximumBytes: number,
): value is SafeText {
  return (
    Number.isSafeInteger(maximumBytes) &&
    maximumBytes >= 0 &&
    isSafeText(value) &&
    utf8ByteLength(value) <= maximumBytes
  );
}

export function isCanonicalDecimal(value: string): value is CanonicalDecimal {
  return (
    utf8ByteLength(value) <= MAX_CANONICAL_DECIMAL_BYTES &&
    CANONICAL_DECIMAL.test(value)
  );
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODE.test(value);
}

export function makeSafeIdentifier(value: string): SafeIdentifier | undefined {
  return isSafeIdentifier(value) ? (value as SafeIdentifier) : undefined;
}

export function makeSourceNativeToolName(
  value: string,
): SourceNativeToolName | undefined {
  return isSourceNativeToolName(value)
    ? (value as SourceNativeToolName)
    : undefined;
}

export function makeStableLabel(value: string): StableLabel | undefined {
  return isStableLabel(value) ? (value as StableLabel) : undefined;
}

export function makeSafeText(value: string): SafeText | undefined {
  return isSafeText(value) ? (value as SafeText) : undefined;
}

export function makeBoundedSafeText(
  value: string,
  maximumBytes: number,
): SafeText | undefined {
  return isBoundedSafeText(value, maximumBytes) ? (value as SafeText) : undefined;
}

export function makeCanonicalDecimal(value: string): CanonicalDecimal | undefined {
  return isCanonicalDecimal(value) ? (value as CanonicalDecimal) : undefined;
}

export function makeCurrencyCode(value: string): CurrencyCode | undefined {
  return isCurrencyCode(value) ? (value as CurrencyCode) : undefined;
}

/** Returns the byte length of a serializable durable payload without accepting a JSON bag API. */
export function jsonUtf8ByteLength(value: object): number | undefined {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? utf8ByteLength(encoded) : undefined;
  } catch {
    return undefined;
  }
}

export const TURN_ID__BRAND = "@niceeval/o11y/TurnId" as const;
export const ITEM_ID__BRAND = "@niceeval/o11y/ItemId" as const;
export const CALL_ID__BRAND = "@niceeval/o11y/CallId" as const;
export const COMMAND_ID__BRAND = "@niceeval/o11y/CommandId" as const;
export const USAGE_OBSERVATION_ID__BRAND =
  "@niceeval/o11y/UsageObservationId" as const;
export const INTERVAL_ID__BRAND = "@niceeval/o11y/IntervalId" as const;
export const DIAGNOSTIC_ID__BRAND = "@niceeval/o11y/DiagnosticId" as const;

export type TurnId = string & Brand.Brand<typeof TURN_ID__BRAND>;
export type ItemId = string & Brand.Brand<typeof ITEM_ID__BRAND>;
export type CallId = string & Brand.Brand<typeof CALL_ID__BRAND>;
export type CommandId = string & Brand.Brand<typeof COMMAND_ID__BRAND>;
export type UsageObservationId = string & Brand.Brand<
  typeof USAGE_OBSERVATION_ID__BRAND
>;
export type IntervalId = string & Brand.Brand<typeof INTERVAL_ID__BRAND>;
export type DiagnosticId = string & Brand.Brand<typeof DIAGNOSTIC_ID__BRAND>;

export const OBSERVABILITY_ENTITY_KINDS = Object.freeze([
  "turn",
  "item",
  "call",
  "command",
  "usage-observation",
  "interval",
  "diagnostic",
] as const);

export type ObservabilityEntityKind =
  (typeof OBSERVABILITY_ENTITY_KINDS)[number];

export interface ObservabilityEntityIdByKind {
  readonly turn: TurnId;
  readonly item: ItemId;
  readonly call: CallId;
  readonly command: CommandId;
  readonly "usage-observation": UsageObservationId;
  readonly interval: IntervalId;
  readonly diagnostic: DiagnosticId;
}

export type ObservabilityEntityIdForKind<Kind extends ObservabilityEntityKind> =
  ObservabilityEntityIdByKind[Kind];

export type ObservabilityEntityId =
  ObservabilityEntityIdByKind[ObservabilityEntityKind];

const CROCKFORD_BASE32_LOWER = "0123456789abcdefghjkmnpqrstvwxyz";
const CROCKFORD_BASE32_CHARACTER = "[0123456789abcdefghjkmnpqrstvwxyz]";

const OBSERVABILITY_ENTITY_PREFIXES = Object.freeze({
  turn: "turn_",
  item: "item_",
  call: "call_",
  command: "command_",
  "usage-observation": "usage_",
  interval: "interval_",
  diagnostic: "diagnostic_",
} as const);

function entityIdPattern(prefix: string): RegExp {
  return new RegExp(
    `^${prefix}${CROCKFORD_BASE32_CHARACTER}{${OBSERVABILITY_ENTITY_ID_BASE32_LENGTH}}$`,
  );
}

const TURN_ID_PATTERN = entityIdPattern(OBSERVABILITY_ENTITY_PREFIXES.turn);
const ITEM_ID_PATTERN = entityIdPattern(OBSERVABILITY_ENTITY_PREFIXES.item);
const CALL_ID_PATTERN = entityIdPattern(OBSERVABILITY_ENTITY_PREFIXES.call);
const COMMAND_ID_PATTERN = entityIdPattern(OBSERVABILITY_ENTITY_PREFIXES.command);
const USAGE_OBSERVATION_ID_PATTERN = entityIdPattern(
  OBSERVABILITY_ENTITY_PREFIXES["usage-observation"],
);
const INTERVAL_ID_PATTERN = entityIdPattern(OBSERVABILITY_ENTITY_PREFIXES.interval);
const DIAGNOSTIC_ID_PATTERN = entityIdPattern(
  OBSERVABILITY_ENTITY_PREFIXES.diagnostic,
);

export function isTurnId(value: string): value is TurnId {
  return TURN_ID_PATTERN.test(value);
}

export function isItemId(value: string): value is ItemId {
  return ITEM_ID_PATTERN.test(value);
}

export function isCallId(value: string): value is CallId {
  return CALL_ID_PATTERN.test(value);
}

export function isCommandId(value: string): value is CommandId {
  return COMMAND_ID_PATTERN.test(value);
}

export function isUsageObservationId(value: string): value is UsageObservationId {
  return USAGE_OBSERVATION_ID_PATTERN.test(value);
}

export function isIntervalId(value: string): value is IntervalId {
  return INTERVAL_ID_PATTERN.test(value);
}

export function isDiagnosticId(value: string): value is DiagnosticId {
  return DIAGNOSTIC_ID_PATTERN.test(value);
}

export function isObservabilityEntityId(value: string): value is ObservabilityEntityId {
  return (
    isTurnId(value) ||
    isItemId(value) ||
    isCallId(value) ||
    isCommandId(value) ||
    isUsageObservationId(value) ||
    isIntervalId(value) ||
    isDiagnosticId(value)
  );
}

export function makeTurnId(value: string): TurnId | undefined {
  return isTurnId(value) ? (value as TurnId) : undefined;
}

export function makeItemId(value: string): ItemId | undefined {
  return isItemId(value) ? (value as ItemId) : undefined;
}

export function makeCallId(value: string): CallId | undefined {
  return isCallId(value) ? (value as CallId) : undefined;
}

export function makeCommandId(value: string): CommandId | undefined {
  return isCommandId(value) ? (value as CommandId) : undefined;
}

export function makeUsageObservationId(
  value: string,
): UsageObservationId | undefined {
  return isUsageObservationId(value) ? (value as UsageObservationId) : undefined;
}

export function makeIntervalId(value: string): IntervalId | undefined {
  return isIntervalId(value) ? (value as IntervalId) : undefined;
}

export function makeDiagnosticId(value: string): DiagnosticId | undefined {
  return isDiagnosticId(value) ? (value as DiagnosticId) : undefined;
}

export function isObservabilityEntityIdForKind<
  Kind extends ObservabilityEntityKind,
>(value: string, kind: Kind): value is ObservabilityEntityIdForKind<Kind> {
  switch (kind) {
    case "turn":
      return isTurnId(value);
    case "item":
      return isItemId(value);
    case "call":
      return isCallId(value);
    case "command":
      return isCommandId(value);
    case "usage-observation":
      return isUsageObservationId(value);
    case "interval":
      return isIntervalId(value);
    case "diagnostic":
      return isDiagnosticId(value);
  }
}

export function makeObservabilityEntityId<Kind extends ObservabilityEntityKind>(
  value: string,
  kind: Kind,
): ObservabilityEntityIdForKind<Kind> | undefined {
  return isObservabilityEntityIdForKind(value, kind)
    ? (value as ObservabilityEntityIdForKind<Kind>)
    : undefined;
}

/** Encodes exactly 128 bits as the durable lower-case Crockford base-32 suffix. */
export function encodeObservabilityEntityEntropy(
  entropy: Uint8Array,
): string | undefined {
  if (entropy.byteLength !== MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES) {
    return undefined;
  }
  let pendingBits = 0;
  let pendingValue = 0;
  let encoded = "";
  for (const byte of entropy) {
    pendingValue = (pendingValue << 8) | byte;
    pendingBits += 8;
    while (pendingBits >= 5) {
      pendingBits -= 5;
      encoded += CROCKFORD_BASE32_LOWER[(pendingValue >> pendingBits) & 0b1_1111];
    }
  }
  if (pendingBits > 0) {
    encoded += CROCKFORD_BASE32_LOWER[(pendingValue << (5 - pendingBits)) & 0b1_1111];
  }
  return encoded.length === OBSERVABILITY_ENTITY_ID_BASE32_LENGTH
    ? encoded
    : undefined;
}

export function entityIdFromEntropy<Kind extends ObservabilityEntityKind>(
  kind: Kind,
  entropy: Uint8Array,
): ObservabilityEntityIdForKind<Kind> | undefined {
  const suffix = encodeObservabilityEntityEntropy(entropy);
  return suffix === undefined
    ? undefined
    : makeObservabilityEntityId(
        `${OBSERVABILITY_ENTITY_PREFIXES[kind]}${suffix}`,
        kind,
      );
}

export const ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS = Object.freeze([
  "niceeval.agent-turns",
  "niceeval.sandbox-commands",
  "niceeval.runner-activities",
  "niceeval.runner-diagnostics",
] as const);

export const RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS = Object.freeze([
  "niceeval.runner-activities",
  "niceeval.runner-diagnostics",
] as const);

export type AttemptObservabilityFamilySchemaId =
  (typeof ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS)[number];
export type RunObservabilityFamilySchemaId =
  (typeof RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS)[number];
export type ObservabilityFamilySchemaId =
  | AttemptObservabilityFamilySchemaId
  | RunObservabilityFamilySchemaId;
export type ObservabilityOwner = "attempt" | "run";

export function isAttemptObservabilityFamilySchemaId(
  value: string,
): value is AttemptObservabilityFamilySchemaId {
  return ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS.includes(
    value as AttemptObservabilityFamilySchemaId,
  );
}

export function isRunObservabilityFamilySchemaId(
  value: string,
): value is RunObservabilityFamilySchemaId {
  return RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS.includes(
    value as RunObservabilityFamilySchemaId,
  );
}

export type ConversationTurnReferenceTarget = {
  readonly family: "niceeval.agent-turns";
  readonly kind: "turn";
  readonly id: TurnId;
};
export type ConversationItemReferenceTarget = {
  readonly family: "niceeval.agent-turns";
  readonly kind: "item";
  readonly id: ItemId;
};
export type ConversationCallReferenceTarget = {
  readonly family: "niceeval.agent-turns";
  readonly kind: "call";
  readonly id: CallId;
};
export type CommandReferenceTarget = {
  readonly family: "niceeval.sandbox-commands";
  readonly kind: "command";
  readonly id: CommandId;
};
export type UsageObservationReferenceTarget = {
  readonly family: "niceeval.agent-turns";
  readonly kind: "usage-observation";
  readonly id: UsageObservationId;
};
export type IntervalReferenceTarget = {
  readonly family: "niceeval.runner-activities";
  readonly kind: "interval";
  readonly id: IntervalId;
};
export type DiagnosticReferenceTarget = {
  readonly family: "niceeval.runner-diagnostics";
  readonly kind: "diagnostic";
  readonly id: DiagnosticId;
};

export type AttemptReferenceTarget =
  | ConversationTurnReferenceTarget
  | ConversationItemReferenceTarget
  | ConversationCallReferenceTarget
  | CommandReferenceTarget
  | UsageObservationReferenceTarget
  | IntervalReferenceTarget
  | DiagnosticReferenceTarget;

export type RunReferenceTarget = IntervalReferenceTarget | DiagnosticReferenceTarget;
export type ObservabilityReferenceTarget =
  | AttemptReferenceTarget
  | RunReferenceTarget;

/** Intermediate capture joins remain local to one Observability payload. */
export type ConversationReferences = AttemptReferenceTarget;
export type CommandsReferences = AttemptReferenceTarget;
export type UsageReferences = AttemptReferenceTarget;
export type AttemptTimingReferences = AttemptReferenceTarget;
export type AttemptDiagnosticsReferences = AttemptReferenceTarget;
export type RunTimingReferences = RunReferenceTarget;
export type RunDiagnosticsReferences = RunReferenceTarget;

export type AttemptReferencesForFamily<
  Family extends AttemptObservabilityFamilySchemaId,
> = AttemptReferenceTarget;

export type RunReferencesForFamily<
  Family extends RunObservabilityFamilySchemaId,
> = RunReferenceTarget;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function isReferenceFields(
  value: unknown,
): value is { readonly family: string; readonly kind: string; readonly id: string } {
  if (!isObject(value)) return false;
  const family = ownDataProperty(value, "family");
  const kind = ownDataProperty(value, "kind");
  const id = ownDataProperty(value, "id");
  return typeof family === "string" && typeof kind === "string" && typeof id === "string";
}

export function isAttemptReferenceTarget(
  value: unknown,
): value is AttemptReferenceTarget {
  if (!isReferenceFields(value)) return false;
  switch (value.kind) {
    case "turn":
      return value.family === "niceeval.agent-turns" && isTurnId(value.id);
    case "item":
      return value.family === "niceeval.agent-turns" && isItemId(value.id);
    case "call":
      return value.family === "niceeval.agent-turns" && isCallId(value.id);
    case "command":
      return value.family === "niceeval.sandbox-commands" && isCommandId(value.id);
    case "usage-observation":
      return value.family === "niceeval.agent-turns" && isUsageObservationId(value.id);
    case "interval":
      return value.family === "niceeval.runner-activities" && isIntervalId(value.id);
    case "diagnostic":
      return value.family === "niceeval.runner-diagnostics" && isDiagnosticId(value.id);
    default:
      return false;
  }
}

export function isRunReferenceTarget(value: unknown): value is RunReferenceTarget {
  if (!isReferenceFields(value)) return false;
  return (
    (value.family === "niceeval.runner-activities" &&
      value.kind === "interval" &&
      isIntervalId(value.id)) ||
    (value.family === "niceeval.runner-diagnostics" &&
      value.kind === "diagnostic" &&
      isDiagnosticId(value.id))
  );
}

export function compareObservabilityText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function referenceTargetKey(target: ObservabilityReferenceTarget): string {
  return `${target.family}\u0000${target.kind}\u0000${target.id}`;
}

export function compareObservabilityReferenceTarget(
  left: ObservabilityReferenceTarget,
  right: ObservabilityReferenceTarget,
): number {
  const family = compareObservabilityText(left.family, right.family);
  if (family !== 0) return family;
  const kind = compareObservabilityText(left.kind, right.kind);
  return kind === 0 ? compareObservabilityText(left.id, right.id) : kind;
}

export function isCanonicalAttemptReferences(
  refs: readonly AttemptReferenceTarget[],
  _sourceFamily?: AttemptObservabilityFamilySchemaId,
): boolean {
  if (refs.length > MAX_DIRECT_CROSS_FAMILY_REFS) return false;
  let prior: AttemptReferenceTarget | undefined;
  for (const ref of refs) {
    if (!isAttemptReferenceTarget(ref)) return false;
    if (prior !== undefined && compareObservabilityReferenceTarget(prior, ref) >= 0) {
      return false;
    }
    prior = ref;
  }
  return true;
}

export function isCanonicalRunReferences(
  refs: readonly RunReferenceTarget[],
  _sourceFamily?: RunObservabilityFamilySchemaId,
): boolean {
  if (refs.length > MAX_DIRECT_CROSS_FAMILY_REFS) return false;
  let prior: RunReferenceTarget | undefined;
  for (const ref of refs) {
    if (!isRunReferenceTarget(ref)) return false;
    if (prior !== undefined && compareObservabilityReferenceTarget(prior, ref) >= 0) {
      return false;
    }
    prior = ref;
  }
  return true;
}

export const COLLECTION_TARGETS = Object.freeze([
  "conversation-item",
  "conversation-text",
  "command-manifest",
  "command-stdout",
  "command-stderr",
  "usage-observation",
  "timing-interval",
  "diagnostic",
] as const);

export type CollectionTarget = (typeof COLLECTION_TARGETS)[number];

export const COLLECTION_STAGES = Object.freeze([
  "adapter",
  "command-capture",
  "usage-capture",
  "timing-capture",
  "diagnostic-capture",
  "attempt-finalizer",
  "run-teardown",
] as const);

export type CollectionStage = (typeof COLLECTION_STAGES)[number];

function includesLiteral<Literal extends string>(
  values: readonly Literal[],
  value: string,
): value is Literal {
  return values.some((candidate) => candidate === value);
}

export function isCollectionTarget(value: string): value is CollectionTarget {
  return includesLiteral(COLLECTION_TARGETS, value);
}

export function isCollectionStage(value: string): value is CollectionStage {
  return includesLiteral(COLLECTION_STAGES, value);
}

export type ObservabilityLimitation =
  | {
      readonly code: "capture-failed";
      readonly stage: CollectionStage;
      readonly target: CollectionTarget;
    }
  | {
      readonly code: "capture-interrupted";
      readonly stage: CollectionStage;
      readonly target: CollectionTarget;
    }
  | {
      readonly code: "collection-cap-reached";
      readonly target: CollectionTarget;
      readonly retained: NonNegativeSafeInteger;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "unsupported-input";
      readonly target: CollectionTarget;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "conversation-text";
      readonly itemId: ItemId;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "command-manifest";
      readonly commandId: CommandId;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "diagnostic";
      readonly diagnosticId: DiagnosticId;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "stream-truncated";
      readonly commandId: CommandId;
      readonly stream: "stdout" | "stderr";
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "invalid-utf8-replaced";
      readonly commandId: CommandId;
      readonly stream: "stdout" | "stderr";
      readonly replacementCount: PositiveSafeInteger;
    }
  | {
      readonly code: "unsafe-control-stripped";
      readonly commandId: CommandId;
      readonly stream: "stdout" | "stderr";
      readonly strippedCount: PositiveSafeInteger;
    }
  | {
      readonly code: "redacted";
      readonly target: CollectionTarget;
      readonly replacementCount: PositiveSafeInteger;
    };

export type Collection<Limitation extends ObservabilityLimitation = ObservabilityLimitation> =
  | {
      readonly state: "complete";
      readonly limitations: readonly [];
    }
  | {
      readonly state: "partial";
      readonly limitations: NonEmptyReadonlyArray<Limitation>;
    };

export type ObservabilityCollection<
  Limitation extends ObservabilityLimitation = ObservabilityLimitation,
> = Collection<Limitation>;

export function limitationTarget(limitation: ObservabilityLimitation): CollectionTarget {
  switch (limitation.code) {
    case "stream-truncated":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return limitation.stream === "stdout" ? "command-stdout" : "command-stderr";
    default:
      return limitation.target;
  }
}

export function limitationEntityId(limitation: ObservabilityLimitation): string {
  switch (limitation.code) {
    case "text-truncated":
      if (limitation.target === "conversation-text") return limitation.itemId;
      if (limitation.target === "command-manifest") return limitation.commandId;
      return limitation.diagnosticId;
    case "stream-truncated":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return limitation.commandId;
    default:
      return "";
  }
}

function limitationStage(limitation: ObservabilityLimitation): string {
  return limitation.code === "capture-failed" || limitation.code === "capture-interrupted"
    ? limitation.stage
    : "";
}

/** A duplicate aggregation key means collector counts were not coalesced. */
export function observabilityLimitationAggregationKey(
  limitation: ObservabilityLimitation,
): string {
  return [
    limitation.code,
    limitationTarget(limitation),
    limitationEntityId(limitation),
    limitationStage(limitation),
  ].join("\u0000");
}

export function compareObservabilityLimitation(
  left: ObservabilityLimitation,
  right: ObservabilityLimitation,
): number {
  const code = compareObservabilityText(left.code, right.code);
  if (code !== 0) return code;
  const target = compareObservabilityText(
    limitationTarget(left),
    limitationTarget(right),
  );
  if (target !== 0) return target;
  const entity = compareObservabilityText(
    limitationEntityId(left),
    limitationEntityId(right),
  );
  return entity !== 0
    ? entity
    : compareObservabilityText(limitationStage(left), limitationStage(right));
}

function isCommandStream(value: string): value is "stdout" | "stderr" {
  return value === "stdout" || value === "stderr";
}

/** Structural durable validation remains Schema's job; this verifies field semantics. */
export function isObservabilityLimitation(
  limitation: ObservabilityLimitation,
): boolean {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return (
        isCollectionStage(limitation.stage) && isCollectionTarget(limitation.target)
      );
    case "collection-cap-reached":
      return (
        isCollectionTarget(limitation.target) &&
        isNonNegativeSafeInteger(limitation.retained) &&
        isPositiveSafeInteger(limitation.omittedAtLeast)
      );
    case "unsupported-input":
      return (
        isCollectionTarget(limitation.target) &&
        isPositiveSafeInteger(limitation.omittedAtLeast)
      );
    case "text-truncated":
      return (
        isNonNegativeSafeInteger(limitation.retainedBytes) &&
        isPositiveSafeInteger(limitation.omittedBytes) &&
        ((limitation.target === "conversation-text" && isItemId(limitation.itemId)) ||
          (limitation.target === "command-manifest" &&
            isCommandId(limitation.commandId)) ||
          (limitation.target === "diagnostic" &&
            isDiagnosticId(limitation.diagnosticId)))
      );
    case "stream-truncated":
      return (
        isCommandId(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isNonNegativeSafeInteger(limitation.retainedBytes) &&
        isPositiveSafeInteger(limitation.omittedBytes)
      );
    case "invalid-utf8-replaced":
      return (
        isCommandId(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isPositiveSafeInteger(limitation.replacementCount)
      );
    case "unsafe-control-stripped":
      return (
        isCommandId(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isPositiveSafeInteger(limitation.strippedCount)
      );
    case "redacted":
      return (
        isCollectionTarget(limitation.target) &&
        isPositiveSafeInteger(limitation.replacementCount)
      );
  }
}

export type ObservabilityCollectionValidationIssue =
  | { readonly code: "observability-collection-state-invalid" }
  | {
      readonly code: "observability-limitation-invalid";
      readonly index: NonNegativeSafeInteger;
    }
  | {
      readonly code: "observability-limitation-order-invalid";
      readonly index: PositiveSafeInteger;
    }
  | {
      readonly code: "observability-limitation-duplicate";
      readonly index: PositiveSafeInteger;
    };

/** Validates complete/partial cardinality plus canonical, coalesced limitations. */
export function validateObservabilityCollection(
  collection: Collection,
): readonly ObservabilityCollectionValidationIssue[] {
  const issues: ObservabilityCollectionValidationIssue[] = [];
  if (
    (collection.state === "complete" && collection.limitations.length !== 0) ||
    (collection.state === "partial" && collection.limitations.length === 0)
  ) {
    issues.push(Object.freeze({ code: "observability-collection-state-invalid" as const }));
  }
  let previous: ObservabilityLimitation | undefined;
  const aggregateKeys = new Set<string>();
  for (const [index, limitation] of collection.limitations.entries()) {
    const indexValue = makeNonNegativeSafeInteger(index);
    if (indexValue === undefined) throw new Error("Array index must be a safe integer");
    if (!isObservabilityLimitation(limitation)) {
      issues.push(
        Object.freeze({
          code: "observability-limitation-invalid" as const,
          index: indexValue,
        }),
      );
      continue;
    }
    if (previous !== undefined && compareObservabilityLimitation(previous, limitation) >= 0) {
      const positiveIndex = makePositiveSafeInteger(index);
      if (positiveIndex === undefined) throw new Error("Non-first array index must be positive");
      issues.push(
        Object.freeze({
          code: "observability-limitation-order-invalid" as const,
          index: positiveIndex,
        }),
      );
    }
    const aggregationKey = observabilityLimitationAggregationKey(limitation);
    if (aggregateKeys.has(aggregationKey)) {
      const positiveIndex = makePositiveSafeInteger(index);
      if (positiveIndex === undefined) throw new Error("Duplicate cannot be at index zero");
      issues.push(
        Object.freeze({
          code: "observability-limitation-duplicate" as const,
          index: positiveIndex,
        }),
      );
    }
    aggregateKeys.add(aggregationKey);
    previous = limitation;
  }
  return Object.freeze(issues);
}
