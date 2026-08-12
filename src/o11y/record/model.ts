import type { Brand } from "effect";
import {
  MAX_CANONICAL_DECIMAL_BYTES_V1,
  MAX_DIRECT_CROSS_FAMILY_REFS_V1,
  MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES_V1,
  MAX_SAFE_IDENTIFIER_BYTES_V1,
  MAX_STABLE_LABEL_BYTES_V1,
  OBSERVABILITY_ENTITY_ID_BASE32_LENGTH_V1,
} from "./limits.ts";

/** A readonly non-empty sequence used by durable complete/partial states. */
export type NonEmptyReadonlyArray<Item> = readonly [Item, ...Item[]];

export const NON_NEGATIVE_SAFE_INTEGER_V1_BRAND =
  "@niceeval/o11y/NonNegativeSafeIntegerV1" as const;
export const POSITIVE_SAFE_INTEGER_V1_BRAND =
  "@niceeval/o11y/PositiveSafeIntegerV1" as const;
export const SAFE_IDENTIFIER_V1_BRAND =
  "@niceeval/o11y/SafeIdentifierV1" as const;
export const STABLE_LABEL_V1_BRAND =
  "@niceeval/o11y/StableLabelV1" as const;
export const SAFE_TEXT_V1_BRAND = "@niceeval/o11y/SafeTextV1" as const;
export const CANONICAL_DECIMAL_V1_BRAND =
  "@niceeval/o11y/CanonicalDecimalV1" as const;
export const CURRENCY_CODE_V1_BRAND = "@niceeval/o11y/CurrencyCodeV1" as const;

export type NonNegativeSafeInteger = number & Brand.Brand<
  typeof NON_NEGATIVE_SAFE_INTEGER_V1_BRAND
>;
export type PositiveSafeInteger = number & Brand.Brand<
  typeof POSITIVE_SAFE_INTEGER_V1_BRAND
>;
export type SafeIdentifier = string & Brand.Brand<typeof SAFE_IDENTIFIER_V1_BRAND>;
export type StableLabel = string & Brand.Brand<typeof STABLE_LABEL_V1_BRAND>;
export type SafeText = string & Brand.Brand<typeof SAFE_TEXT_V1_BRAND>;
export type CanonicalDecimal = string & Brand.Brand<
  typeof CANONICAL_DECIMAL_V1_BRAND
>;
export type CurrencyCode = string & Brand.Brand<typeof CURRENCY_CODE_V1_BRAND>;

/** v1 aliases keep field types visibly tied to this durable format. */
export type NonNegativeSafeIntegerV1 = NonNegativeSafeInteger;
export type PositiveSafeIntegerV1 = PositiveSafeInteger;
export type SafeIdentifierV1 = SafeIdentifier;
export type StableLabelV1 = StableLabel;
export type SafeTextV1 = SafeText;
export type CanonicalDecimalV1 = CanonicalDecimal;
export type CurrencyCodeV1 = CurrencyCode;

const UTF8 = new TextEncoder();
const SAFE_IDENTIFIER = /^[a-z][a-z0-9.-]{0,63}$/;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
/** C0 controls are never durable SafeText except the LF line separator. */
const UNSAFE_SAFE_TEXT_CONTROL = /[\u0000-\u0009\u000B-\u001F]/u;

export function utf8ByteLengthV1(value: string): number {
  return UTF8.encode(value).byteLength;
}

/** JavaScript strings with an unmatched surrogate do not represent UTF-8 text. */
export function isStrictUnicodeTextV1(value: string): boolean {
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

export function isNonNegativeSafeIntegerV1(value: number): value is NonNegativeSafeInteger {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveSafeIntegerV1(value: number): value is PositiveSafeInteger {
  return Number.isSafeInteger(value) && value > 0;
}

export function makeNonNegativeSafeIntegerV1(
  value: number,
): NonNegativeSafeInteger | undefined {
  return isNonNegativeSafeIntegerV1(value) ? (value as NonNegativeSafeInteger) : undefined;
}

export function makePositiveSafeIntegerV1(
  value: number,
): PositiveSafeInteger | undefined {
  return isPositiveSafeIntegerV1(value) ? (value as PositiveSafeInteger) : undefined;
}

export function isSafeIdentifierV1(value: string): value is SafeIdentifier {
  return (
    utf8ByteLengthV1(value) <= MAX_SAFE_IDENTIFIER_BYTES_V1 &&
    SAFE_IDENTIFIER.test(value)
  );
}

export function isStableLabelV1(value: string): value is StableLabel {
  return (
    utf8ByteLengthV1(value) <= MAX_STABLE_LABEL_BYTES_V1 &&
    SAFE_IDENTIFIER.test(value)
  );
}

export function isSafeTextV1(value: string): value is SafeText {
  return isStrictUnicodeTextV1(value) && !UNSAFE_SAFE_TEXT_CONTROL.test(value);
}

export function isBoundedSafeTextV1(
  value: string,
  maximumBytes: number,
): value is SafeText {
  return (
    Number.isSafeInteger(maximumBytes) &&
    maximumBytes >= 0 &&
    isSafeTextV1(value) &&
    utf8ByteLengthV1(value) <= maximumBytes
  );
}

export function isCanonicalDecimalV1(value: string): value is CanonicalDecimal {
  return (
    utf8ByteLengthV1(value) <= MAX_CANONICAL_DECIMAL_BYTES_V1 &&
    CANONICAL_DECIMAL.test(value)
  );
}

export function isCurrencyCodeV1(value: string): value is CurrencyCode {
  return CURRENCY_CODE.test(value);
}

export function makeSafeIdentifierV1(value: string): SafeIdentifier | undefined {
  return isSafeIdentifierV1(value) ? (value as SafeIdentifier) : undefined;
}

export function makeStableLabelV1(value: string): StableLabel | undefined {
  return isStableLabelV1(value) ? (value as StableLabel) : undefined;
}

export function makeSafeTextV1(value: string): SafeText | undefined {
  return isSafeTextV1(value) ? (value as SafeText) : undefined;
}

export function makeBoundedSafeTextV1(
  value: string,
  maximumBytes: number,
): SafeText | undefined {
  return isBoundedSafeTextV1(value, maximumBytes) ? (value as SafeText) : undefined;
}

export function makeCanonicalDecimalV1(value: string): CanonicalDecimal | undefined {
  return isCanonicalDecimalV1(value) ? (value as CanonicalDecimal) : undefined;
}

export function makeCurrencyCodeV1(value: string): CurrencyCode | undefined {
  return isCurrencyCodeV1(value) ? (value as CurrencyCode) : undefined;
}

/** Returns the byte length of a serializable durable payload without accepting a JSON bag API. */
export function jsonUtf8ByteLengthV1(value: object): number | undefined {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? utf8ByteLengthV1(encoded) : undefined;
  } catch {
    return undefined;
  }
}

export const TURN_ID_V1_BRAND = "@niceeval/o11y/TurnIdV1" as const;
export const ITEM_ID_V1_BRAND = "@niceeval/o11y/ItemIdV1" as const;
export const CALL_ID_V1_BRAND = "@niceeval/o11y/CallIdV1" as const;
export const COMMAND_ID_V1_BRAND = "@niceeval/o11y/CommandIdV1" as const;
export const USAGE_OBSERVATION_ID_V1_BRAND =
  "@niceeval/o11y/UsageObservationIdV1" as const;
export const INTERVAL_ID_V1_BRAND = "@niceeval/o11y/IntervalIdV1" as const;
export const DIAGNOSTIC_ID_V1_BRAND = "@niceeval/o11y/DiagnosticIdV1" as const;

export type TurnIdV1 = string & Brand.Brand<typeof TURN_ID_V1_BRAND>;
export type ItemIdV1 = string & Brand.Brand<typeof ITEM_ID_V1_BRAND>;
export type CallIdV1 = string & Brand.Brand<typeof CALL_ID_V1_BRAND>;
export type CommandIdV1 = string & Brand.Brand<typeof COMMAND_ID_V1_BRAND>;
export type UsageObservationIdV1 = string & Brand.Brand<
  typeof USAGE_OBSERVATION_ID_V1_BRAND
>;
export type IntervalIdV1 = string & Brand.Brand<typeof INTERVAL_ID_V1_BRAND>;
export type DiagnosticIdV1 = string & Brand.Brand<typeof DIAGNOSTIC_ID_V1_BRAND>;

export const OBSERVABILITY_ENTITY_KINDS_V1 = Object.freeze([
  "turn",
  "item",
  "call",
  "command",
  "usage-observation",
  "interval",
  "diagnostic",
] as const);

export type ObservabilityEntityKindV1 =
  (typeof OBSERVABILITY_ENTITY_KINDS_V1)[number];

export interface ObservabilityEntityIdByKindV1 {
  readonly turn: TurnIdV1;
  readonly item: ItemIdV1;
  readonly call: CallIdV1;
  readonly command: CommandIdV1;
  readonly "usage-observation": UsageObservationIdV1;
  readonly interval: IntervalIdV1;
  readonly diagnostic: DiagnosticIdV1;
}

export type ObservabilityEntityIdForKindV1<Kind extends ObservabilityEntityKindV1> =
  ObservabilityEntityIdByKindV1[Kind];

export type ObservabilityEntityIdV1 =
  ObservabilityEntityIdByKindV1[ObservabilityEntityKindV1];

const CROCKFORD_BASE32_LOWER_V1 = "0123456789abcdefghjkmnpqrstvwxyz";
const CROCKFORD_BASE32_CHARACTER_V1 = "[0123456789abcdefghjkmnpqrstvwxyz]";

const OBSERVABILITY_ENTITY_PREFIXES_V1 = Object.freeze({
  turn: "turn_",
  item: "item_",
  call: "call_",
  command: "command_",
  "usage-observation": "usage_",
  interval: "interval_",
  diagnostic: "diagnostic_",
} as const);

function entityIdPatternV1(prefix: string): RegExp {
  return new RegExp(
    `^${prefix}${CROCKFORD_BASE32_CHARACTER_V1}{${OBSERVABILITY_ENTITY_ID_BASE32_LENGTH_V1}}$`,
  );
}

const TURN_ID_PATTERN_V1 = entityIdPatternV1(OBSERVABILITY_ENTITY_PREFIXES_V1.turn);
const ITEM_ID_PATTERN_V1 = entityIdPatternV1(OBSERVABILITY_ENTITY_PREFIXES_V1.item);
const CALL_ID_PATTERN_V1 = entityIdPatternV1(OBSERVABILITY_ENTITY_PREFIXES_V1.call);
const COMMAND_ID_PATTERN_V1 = entityIdPatternV1(OBSERVABILITY_ENTITY_PREFIXES_V1.command);
const USAGE_OBSERVATION_ID_PATTERN_V1 = entityIdPatternV1(
  OBSERVABILITY_ENTITY_PREFIXES_V1["usage-observation"],
);
const INTERVAL_ID_PATTERN_V1 = entityIdPatternV1(OBSERVABILITY_ENTITY_PREFIXES_V1.interval);
const DIAGNOSTIC_ID_PATTERN_V1 = entityIdPatternV1(
  OBSERVABILITY_ENTITY_PREFIXES_V1.diagnostic,
);

export function isTurnIdV1(value: string): value is TurnIdV1 {
  return TURN_ID_PATTERN_V1.test(value);
}

export function isItemIdV1(value: string): value is ItemIdV1 {
  return ITEM_ID_PATTERN_V1.test(value);
}

export function isCallIdV1(value: string): value is CallIdV1 {
  return CALL_ID_PATTERN_V1.test(value);
}

export function isCommandIdV1(value: string): value is CommandIdV1 {
  return COMMAND_ID_PATTERN_V1.test(value);
}

export function isUsageObservationIdV1(value: string): value is UsageObservationIdV1 {
  return USAGE_OBSERVATION_ID_PATTERN_V1.test(value);
}

export function isIntervalIdV1(value: string): value is IntervalIdV1 {
  return INTERVAL_ID_PATTERN_V1.test(value);
}

export function isDiagnosticIdV1(value: string): value is DiagnosticIdV1 {
  return DIAGNOSTIC_ID_PATTERN_V1.test(value);
}

export function makeTurnIdV1(value: string): TurnIdV1 | undefined {
  return isTurnIdV1(value) ? (value as TurnIdV1) : undefined;
}

export function makeItemIdV1(value: string): ItemIdV1 | undefined {
  return isItemIdV1(value) ? (value as ItemIdV1) : undefined;
}

export function makeCallIdV1(value: string): CallIdV1 | undefined {
  return isCallIdV1(value) ? (value as CallIdV1) : undefined;
}

export function makeCommandIdV1(value: string): CommandIdV1 | undefined {
  return isCommandIdV1(value) ? (value as CommandIdV1) : undefined;
}

export function makeUsageObservationIdV1(
  value: string,
): UsageObservationIdV1 | undefined {
  return isUsageObservationIdV1(value) ? (value as UsageObservationIdV1) : undefined;
}

export function makeIntervalIdV1(value: string): IntervalIdV1 | undefined {
  return isIntervalIdV1(value) ? (value as IntervalIdV1) : undefined;
}

export function makeDiagnosticIdV1(value: string): DiagnosticIdV1 | undefined {
  return isDiagnosticIdV1(value) ? (value as DiagnosticIdV1) : undefined;
}

export function isObservabilityEntityIdForKindV1<
  Kind extends ObservabilityEntityKindV1,
>(value: string, kind: Kind): value is ObservabilityEntityIdForKindV1<Kind> {
  switch (kind) {
    case "turn":
      return isTurnIdV1(value);
    case "item":
      return isItemIdV1(value);
    case "call":
      return isCallIdV1(value);
    case "command":
      return isCommandIdV1(value);
    case "usage-observation":
      return isUsageObservationIdV1(value);
    case "interval":
      return isIntervalIdV1(value);
    case "diagnostic":
      return isDiagnosticIdV1(value);
  }
}

export function makeObservabilityEntityIdV1<Kind extends ObservabilityEntityKindV1>(
  value: string,
  kind: Kind,
): ObservabilityEntityIdForKindV1<Kind> | undefined {
  return isObservabilityEntityIdForKindV1(value, kind)
    ? (value as ObservabilityEntityIdForKindV1<Kind>)
    : undefined;
}

/** Encodes exactly 128 bits as the durable lower-case Crockford base-32 suffix. */
export function encodeObservabilityEntityEntropyV1(
  entropy: Uint8Array,
): string | undefined {
  if (entropy.byteLength !== MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES_V1) {
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
      encoded += CROCKFORD_BASE32_LOWER_V1[(pendingValue >> pendingBits) & 0b1_1111];
    }
  }
  if (pendingBits > 0) {
    encoded += CROCKFORD_BASE32_LOWER_V1[(pendingValue << (5 - pendingBits)) & 0b1_1111];
  }
  return encoded.length === OBSERVABILITY_ENTITY_ID_BASE32_LENGTH_V1
    ? encoded
    : undefined;
}

export function entityIdFromEntropyV1<Kind extends ObservabilityEntityKindV1>(
  kind: Kind,
  entropy: Uint8Array,
): ObservabilityEntityIdForKindV1<Kind> | undefined {
  const suffix = encodeObservabilityEntityEntropyV1(entropy);
  return suffix === undefined
    ? undefined
    : makeObservabilityEntityIdV1(
        `${OBSERVABILITY_ENTITY_PREFIXES_V1[kind]}${suffix}`,
        kind,
      );
}

export const ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1 = Object.freeze([
  "niceeval.conversation/v1",
  "niceeval.commands/v1",
  "niceeval.usage/v1",
  "niceeval.timing/v1",
  "niceeval.diagnostics/v1",
] as const);

export const RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1 = Object.freeze([
  "niceeval.timing/v1",
  "niceeval.diagnostics/v1",
] as const);

export type AttemptObservabilityFamilySchemaIdV1 =
  (typeof ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1)[number];
export type RunObservabilityFamilySchemaIdV1 =
  (typeof RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1)[number];
export type ObservabilityFamilySchemaIdV1 =
  | AttemptObservabilityFamilySchemaIdV1
  | RunObservabilityFamilySchemaIdV1;
export type ObservabilityOwnerV1 = "attempt" | "run";

export function isAttemptObservabilityFamilySchemaIdV1(
  value: string,
): value is AttemptObservabilityFamilySchemaIdV1 {
  return ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1.includes(
    value as AttemptObservabilityFamilySchemaIdV1,
  );
}

export function isRunObservabilityFamilySchemaIdV1(
  value: string,
): value is RunObservabilityFamilySchemaIdV1 {
  return RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1.includes(
    value as RunObservabilityFamilySchemaIdV1,
  );
}

export type ConversationTurnReferenceTargetV1 = {
  readonly family: "niceeval.conversation/v1";
  readonly kind: "turn";
  readonly id: TurnIdV1;
};
export type ConversationItemReferenceTargetV1 = {
  readonly family: "niceeval.conversation/v1";
  readonly kind: "item";
  readonly id: ItemIdV1;
};
export type ConversationCallReferenceTargetV1 = {
  readonly family: "niceeval.conversation/v1";
  readonly kind: "call";
  readonly id: CallIdV1;
};
export type CommandReferenceTargetV1 = {
  readonly family: "niceeval.commands/v1";
  readonly kind: "command";
  readonly id: CommandIdV1;
};
export type UsageObservationReferenceTargetV1 = {
  readonly family: "niceeval.usage/v1";
  readonly kind: "usage-observation";
  readonly id: UsageObservationIdV1;
};
export type IntervalReferenceTargetV1 = {
  readonly family: "niceeval.timing/v1";
  readonly kind: "interval";
  readonly id: IntervalIdV1;
};
export type DiagnosticReferenceTargetV1 = {
  readonly family: "niceeval.diagnostics/v1";
  readonly kind: "diagnostic";
  readonly id: DiagnosticIdV1;
};

export type AttemptReferenceTargetV1 =
  | ConversationTurnReferenceTargetV1
  | ConversationItemReferenceTargetV1
  | ConversationCallReferenceTargetV1
  | CommandReferenceTargetV1
  | UsageObservationReferenceTargetV1
  | IntervalReferenceTargetV1
  | DiagnosticReferenceTargetV1;

export type RunReferenceTargetV1 = IntervalReferenceTargetV1 | DiagnosticReferenceTargetV1;
export type ObservabilityReferenceTargetV1 =
  | AttemptReferenceTargetV1
  | RunReferenceTargetV1;

export type ConversationReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.conversation/v1" }
>;
export type CommandsReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.commands/v1" }
>;
export type UsageReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.usage/v1" }
>;
export type AttemptTimingReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.timing/v1" }
>;
export type AttemptDiagnosticsReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.diagnostics/v1" }
>;
export type RunTimingReferencesV1 = Exclude<
  RunReferenceTargetV1,
  { readonly family: "niceeval.timing/v1" }
>;
export type RunDiagnosticsReferencesV1 = Exclude<
  RunReferenceTargetV1,
  { readonly family: "niceeval.diagnostics/v1" }
>;

export type AttemptReferencesForFamilyV1<
  Family extends AttemptObservabilityFamilySchemaIdV1,
> = Exclude<AttemptReferenceTargetV1, { readonly family: Family }>;

export type RunReferencesForFamilyV1<
  Family extends RunObservabilityFamilySchemaIdV1,
> = Exclude<RunReferenceTargetV1, { readonly family: Family }>;

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

export function isAttemptReferenceTargetV1(
  value: unknown,
): value is AttemptReferenceTargetV1 {
  if (!isReferenceFields(value)) return false;
  switch (`${value.family}\u0000${value.kind}`) {
    case "niceeval.conversation/v1\u0000turn":
      return isTurnIdV1(value.id);
    case "niceeval.conversation/v1\u0000item":
      return isItemIdV1(value.id);
    case "niceeval.conversation/v1\u0000call":
      return isCallIdV1(value.id);
    case "niceeval.commands/v1\u0000command":
      return isCommandIdV1(value.id);
    case "niceeval.usage/v1\u0000usage-observation":
      return isUsageObservationIdV1(value.id);
    case "niceeval.timing/v1\u0000interval":
      return isIntervalIdV1(value.id);
    case "niceeval.diagnostics/v1\u0000diagnostic":
      return isDiagnosticIdV1(value.id);
    default:
      return false;
  }
}

export function isRunReferenceTargetV1(value: unknown): value is RunReferenceTargetV1 {
  if (!isReferenceFields(value)) return false;
  return (
    (value.family === "niceeval.timing/v1" &&
      value.kind === "interval" &&
      isIntervalIdV1(value.id)) ||
    (value.family === "niceeval.diagnostics/v1" &&
      value.kind === "diagnostic" &&
      isDiagnosticIdV1(value.id))
  );
}

export function compareObservabilityTextV1(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function referenceTargetKeyV1(target: ObservabilityReferenceTargetV1): string {
  return `${target.family}\u0000${target.kind}\u0000${target.id}`;
}

export function compareObservabilityReferenceTargetV1(
  left: ObservabilityReferenceTargetV1,
  right: ObservabilityReferenceTargetV1,
): number {
  const family = compareObservabilityTextV1(left.family, right.family);
  if (family !== 0) return family;
  const kind = compareObservabilityTextV1(left.kind, right.kind);
  return kind === 0 ? compareObservabilityTextV1(left.id, right.id) : kind;
}

export function isCanonicalAttemptReferencesV1(
  refs: readonly AttemptReferenceTargetV1[],
  sourceFamily?: AttemptObservabilityFamilySchemaIdV1,
): boolean {
  if (refs.length > MAX_DIRECT_CROSS_FAMILY_REFS_V1) return false;
  let prior: AttemptReferenceTargetV1 | undefined;
  for (const ref of refs) {
    if (!isAttemptReferenceTargetV1(ref)) return false;
    if (sourceFamily !== undefined && ref.family === sourceFamily) return false;
    if (prior !== undefined && compareObservabilityReferenceTargetV1(prior, ref) >= 0) {
      return false;
    }
    prior = ref;
  }
  return true;
}

export function isCanonicalRunReferencesV1(
  refs: readonly RunReferenceTargetV1[],
  sourceFamily?: RunObservabilityFamilySchemaIdV1,
): boolean {
  if (refs.length > MAX_DIRECT_CROSS_FAMILY_REFS_V1) return false;
  let prior: RunReferenceTargetV1 | undefined;
  for (const ref of refs) {
    if (!isRunReferenceTargetV1(ref)) return false;
    if (sourceFamily !== undefined && ref.family === sourceFamily) return false;
    if (prior !== undefined && compareObservabilityReferenceTargetV1(prior, ref) >= 0) {
      return false;
    }
    prior = ref;
  }
  return true;
}

export const COLLECTION_TARGETS_V1 = Object.freeze([
  "conversation-item",
  "conversation-text",
  "command-manifest",
  "command-stdout",
  "command-stderr",
  "usage-observation",
  "timing-interval",
  "diagnostic",
] as const);

export type CollectionTargetV1 = (typeof COLLECTION_TARGETS_V1)[number];

export const COLLECTION_STAGES_V1 = Object.freeze([
  "adapter",
  "command-capture",
  "usage-capture",
  "timing-capture",
  "diagnostic-capture",
  "attempt-finalizer",
  "run-teardown",
] as const);

export type CollectionStageV1 = (typeof COLLECTION_STAGES_V1)[number];

function includesLiteral<Literal extends string>(
  values: readonly Literal[],
  value: string,
): value is Literal {
  return values.some((candidate) => candidate === value);
}

export function isCollectionTargetV1(value: string): value is CollectionTargetV1 {
  return includesLiteral(COLLECTION_TARGETS_V1, value);
}

export function isCollectionStageV1(value: string): value is CollectionStageV1 {
  return includesLiteral(COLLECTION_STAGES_V1, value);
}

export type ObservabilityLimitationV1 =
  | {
      readonly code: "capture-failed";
      readonly stage: CollectionStageV1;
      readonly target: CollectionTargetV1;
    }
  | {
      readonly code: "capture-interrupted";
      readonly stage: CollectionStageV1;
      readonly target: CollectionTargetV1;
    }
  | {
      readonly code: "collection-cap-reached";
      readonly target: CollectionTargetV1;
      readonly retained: NonNegativeSafeInteger;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "unsupported-input";
      readonly target: CollectionTargetV1;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "conversation-text";
      readonly itemId: ItemIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "command-manifest";
      readonly commandId: CommandIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "diagnostic";
      readonly diagnosticId: DiagnosticIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "stream-truncated";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "invalid-utf8-replaced";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly replacementCount: PositiveSafeInteger;
    }
  | {
      readonly code: "unsafe-control-stripped";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly strippedCount: PositiveSafeInteger;
    }
  | {
      readonly code: "redacted";
      readonly target: CollectionTargetV1;
      readonly replacementCount: PositiveSafeInteger;
    };

export type CollectionV1<Limitation extends ObservabilityLimitationV1 = ObservabilityLimitationV1> =
  | {
      readonly state: "complete";
      readonly limitations: readonly [];
    }
  | {
      readonly state: "partial";
      readonly limitations: NonEmptyReadonlyArray<Limitation>;
    };

export type ObservabilityCollectionV1<
  Limitation extends ObservabilityLimitationV1 = ObservabilityLimitationV1,
> = CollectionV1<Limitation>;

export function limitationTargetV1(limitation: ObservabilityLimitationV1): CollectionTargetV1 {
  switch (limitation.code) {
    case "stream-truncated":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return limitation.stream === "stdout" ? "command-stdout" : "command-stderr";
    default:
      return limitation.target;
  }
}

export function limitationEntityIdV1(limitation: ObservabilityLimitationV1): string {
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

function limitationStageV1(limitation: ObservabilityLimitationV1): string {
  return limitation.code === "capture-failed" || limitation.code === "capture-interrupted"
    ? limitation.stage
    : "";
}

/** A duplicate aggregation key means collector counts were not coalesced. */
export function observabilityLimitationAggregationKeyV1(
  limitation: ObservabilityLimitationV1,
): string {
  return [
    limitation.code,
    limitationTargetV1(limitation),
    limitationEntityIdV1(limitation),
    limitationStageV1(limitation),
  ].join("\u0000");
}

export function compareObservabilityLimitationV1(
  left: ObservabilityLimitationV1,
  right: ObservabilityLimitationV1,
): number {
  const code = compareObservabilityTextV1(left.code, right.code);
  if (code !== 0) return code;
  const target = compareObservabilityTextV1(
    limitationTargetV1(left),
    limitationTargetV1(right),
  );
  if (target !== 0) return target;
  const entity = compareObservabilityTextV1(
    limitationEntityIdV1(left),
    limitationEntityIdV1(right),
  );
  return entity !== 0
    ? entity
    : compareObservabilityTextV1(limitationStageV1(left), limitationStageV1(right));
}

function isCommandStream(value: string): value is "stdout" | "stderr" {
  return value === "stdout" || value === "stderr";
}

/** Structural durable validation remains Schema's job; this verifies field semantics. */
export function isObservabilityLimitationV1(
  limitation: ObservabilityLimitationV1,
): boolean {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return (
        isCollectionStageV1(limitation.stage) && isCollectionTargetV1(limitation.target)
      );
    case "collection-cap-reached":
      return (
        isCollectionTargetV1(limitation.target) &&
        isNonNegativeSafeIntegerV1(limitation.retained) &&
        isPositiveSafeIntegerV1(limitation.omittedAtLeast)
      );
    case "unsupported-input":
      return (
        isCollectionTargetV1(limitation.target) &&
        isPositiveSafeIntegerV1(limitation.omittedAtLeast)
      );
    case "text-truncated":
      return (
        isNonNegativeSafeIntegerV1(limitation.retainedBytes) &&
        isPositiveSafeIntegerV1(limitation.omittedBytes) &&
        ((limitation.target === "conversation-text" && isItemIdV1(limitation.itemId)) ||
          (limitation.target === "command-manifest" &&
            isCommandIdV1(limitation.commandId)) ||
          (limitation.target === "diagnostic" &&
            isDiagnosticIdV1(limitation.diagnosticId)))
      );
    case "stream-truncated":
      return (
        isCommandIdV1(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isNonNegativeSafeIntegerV1(limitation.retainedBytes) &&
        isPositiveSafeIntegerV1(limitation.omittedBytes)
      );
    case "invalid-utf8-replaced":
      return (
        isCommandIdV1(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isPositiveSafeIntegerV1(limitation.replacementCount)
      );
    case "unsafe-control-stripped":
      return (
        isCommandIdV1(limitation.commandId) &&
        isCommandStream(limitation.stream) &&
        isPositiveSafeIntegerV1(limitation.strippedCount)
      );
    case "redacted":
      return (
        isCollectionTargetV1(limitation.target) &&
        isPositiveSafeIntegerV1(limitation.replacementCount)
      );
  }
}

export type ObservabilityCollectionValidationIssueV1 =
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
export function validateObservabilityCollectionV1(
  collection: CollectionV1,
): readonly ObservabilityCollectionValidationIssueV1[] {
  const issues: ObservabilityCollectionValidationIssueV1[] = [];
  if (
    (collection.state === "complete" && collection.limitations.length !== 0) ||
    (collection.state === "partial" && collection.limitations.length === 0)
  ) {
    issues.push(Object.freeze({ code: "observability-collection-state-invalid" as const }));
  }
  let previous: ObservabilityLimitationV1 | undefined;
  const aggregateKeys = new Set<string>();
  for (const [index, limitation] of collection.limitations.entries()) {
    const indexValue = makeNonNegativeSafeIntegerV1(index);
    if (indexValue === undefined) throw new Error("Array index must be a safe integer");
    if (!isObservabilityLimitationV1(limitation)) {
      issues.push(
        Object.freeze({
          code: "observability-limitation-invalid" as const,
          index: indexValue,
        }),
      );
      continue;
    }
    if (previous !== undefined && compareObservabilityLimitationV1(previous, limitation) >= 0) {
      const positiveIndex = makePositiveSafeIntegerV1(index);
      if (positiveIndex === undefined) throw new Error("Non-first array index must be positive");
      issues.push(
        Object.freeze({
          code: "observability-limitation-order-invalid" as const,
          index: positiveIndex,
        }),
      );
    }
    const aggregationKey = observabilityLimitationAggregationKeyV1(limitation);
    if (aggregateKeys.has(aggregationKey)) {
      const positiveIndex = makePositiveSafeIntegerV1(index);
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
