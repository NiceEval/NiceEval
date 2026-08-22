import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createOpaqueMeasure,
  logicalSlots,
  type LogicalSlot,
  type Measure,
} from "./definitions.ts";
import type {
  MetricBasis,
  MetricValue,
} from "./contracts.ts";
import type {
  CanonicalDecimal,
  CurrencyCode,
  SafeIdentifier,
} from "../o11y/record/model.ts";
import {
  isCanonicalDecimal,
  isCurrencyCode,
  isSafeIdentifier,
  isStrictUnicodeText,
  utf8ByteLength,
} from "../o11y/record/model.ts";
import type {
  ExecutionIdentityDigest,
  UtcMillis,
} from "../record/model/identifiers.ts";
import {
  isPortableSegment,
  isRecordDomainIdentity,
  isSha256Digest,
  isUtcMillis,
} from "../record/model/identifiers.ts";
import {
  INDEPENDENTLY_BILLABLE_TOKEN_BUCKETS,
  isIndependentlyBillableTokenBucket,
  type IndependentlyBillableTokenBucket,
} from "./cost-decimal.ts";

/** Cross-ESM/CJS v1 Profile descriptor. Its value is a frozen data record. */
const PricingProfileDescriptor: unique symbol = Symbol.for(
  "niceeval.report.pricing-profile/v1",
) as never;

/** Cross-ESM/CJS v1 profile-bound Measure descriptor. */
const CostMeasureDescriptor: unique symbol = Symbol.for(
  "niceeval.analysis.cost-measure/v1",
) as never;

const validatedPricingProfiles = new WeakSet<object>();

declare const pricingProfileContentIdentityTypeId: unique symbol;
declare const pricingCoverageIdTypeId: unique symbol;

export type PricingProfileContentIdentity = string & {
  readonly [pricingProfileContentIdentityTypeId]: true;
};

export type PricingCoverageId = string & {
  readonly [pricingCoverageIdTypeId]: true;
};

export interface PricingDisplay {
  readonly decimalPlaces: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly rounding: "half-away-from-zero";
}

export interface PricingDisplayInput {
  readonly decimalPlaces: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly rounding: "half-away-from-zero";
}

/** The declaration that made this rate card auditable. */
export interface PricingProvenance {
  readonly kind: "declared-rate-card";
  readonly source: string;
  readonly asOf: UtcMillis;
}

export interface PricingProvenanceInput {
  readonly kind: "declared-rate-card";
  readonly source: string;
  readonly asOf: number;
}

/**
 * Every selector predicate reads the origin Attempt's closed Core projection.
 * Optional dimensions are explicit wildcards; model is required and never
 * inferred from current Report source, the selected target Run, or a provider.
 */
export interface PricingSelector {
  /** Omitted only by a model catalog entry whose quote is provider-neutral. */
  readonly provider?: SafeIdentifier;
  readonly model: string;
  readonly agentId?: string;
  readonly reasoningEffort?: string | null;
  readonly executionIdentityDigest?: ExecutionIdentityDigest;
}

export interface PricingSelectorInput {
  readonly provider?: string;
  readonly model: string;
  readonly agentId?: string;
  readonly reasoningEffort?: string | null;
  readonly executionIdentityDigest?: string;
}

export interface PricingEffectiveCondition {
  readonly startsAt: UtcMillis;
  readonly endsAt: UtcMillis | null;
}

export interface PricingEffectiveConditionInput {
  readonly startsAt: number;
  readonly endsAt: number | null;
}

export interface TokenPricingCharge {
  readonly kind: "token";
  readonly bucket: IndependentlyBillableTokenBucket;
  readonly perMillionTokens: CanonicalDecimal;
}

export interface TokenPricingChargeInput {
  readonly kind: "token";
  readonly bucket: string;
  readonly perMillionTokens: string;
}

export interface RequestPricingCharge {
  readonly kind: "request";
  readonly requestKind: "model" | "tool";
  readonly ratePerRequest: CanonicalDecimal;
}

export interface RequestPricingChargeInput {
  readonly kind: "request";
  readonly requestKind: "model" | "tool";
  readonly ratePerRequest: string;
}

export type PricingCharge = TokenPricingCharge | RequestPricingCharge;
export type PricingChargeInput = TokenPricingChargeInput | RequestPricingChargeInput;

interface PricingCoverageBase {
  readonly coverageId: PricingCoverageId;
  readonly selector: PricingSelector;
  readonly effective: PricingEffectiveCondition;
}

export interface PricedCoverage extends PricingCoverageBase {
  readonly state: "priced";
  readonly charges: readonly [PricingCharge, ...PricingCharge[]];
}

export interface UnpricedCoverage extends PricingCoverageBase {
  readonly state: "unpriced";
  readonly reason:
    | "provider-not-priced"
    | "billing-mode-not-priced"
    | "rate-not-published";
}

export type PricingCoverage = PricedCoverage | UnpricedCoverage;

export interface PricedCoverageInput {
  readonly coverageId: string;
  readonly state: "priced";
  readonly selector: PricingSelectorInput;
  readonly effective: PricingEffectiveConditionInput;
  readonly charges: readonly [PricingChargeInput, ...PricingChargeInput[]];
}

export interface UnpricedCoverageInput {
  readonly coverageId: string;
  readonly state: "unpriced";
  readonly selector: PricingSelectorInput;
  readonly effective: PricingEffectiveConditionInput;
  readonly reason:
    | "provider-not-priced"
    | "billing-mode-not-priced"
    | "rate-not-published";
}

export type PricingCoverageInput = PricedCoverageInput | UnpricedCoverageInput;

interface PricingProfileCanonicalContent {
  readonly version: 1;
  readonly currency: "USD";
  readonly display: PricingDisplay;
  readonly provenance: PricingProvenance;
  readonly coverage: readonly PricingCoverage[];
}

interface PricingProfileDescriptorValue {
  readonly version: 1;
  readonly contentIdentity: PricingProfileContentIdentity;
  readonly content: PricingProfileCanonicalContent;
}

/**
 * v1 profile data is direct and data-only. The global Symbol descriptor lets
 * another ESM/CJS instance revalidate the exact same frozen canonical value.
 */
export interface PricingProfile {
  readonly contentIdentity: PricingProfileContentIdentity;
  readonly currency: "USD";
  readonly display: PricingDisplay;
  readonly provenance: PricingProvenance;
  readonly coverage: readonly PricingCoverage[];
  readonly [PricingProfileDescriptor]: PricingProfileDescriptorValue;
}

export interface PricingProfileInput {
  readonly currency: "USD";
  readonly display: PricingDisplayInput;
  readonly provenance: PricingProvenanceInput;
  readonly coverage: readonly PricingCoverageInput[];
}

export type CostProjectionState = "available" | "partial" | "migration-required" | "unavailable";
export type CostBasis = "observed" | "estimated" | "mixed" | "unavailable";

export interface ProjectedMoney {
  readonly amount: CanonicalDecimal;
  readonly currency: CurrencyCode;
  readonly decimalPlaces: number;
}

/** Closed, auditable profile facts without a source object or calculator. */
export interface CostProjectionProfile {
  readonly contentIdentity: PricingProfileContentIdentity;
  readonly currency: CurrencyCode;
  readonly display: PricingDisplay;
  readonly provenance: PricingProvenance;
  readonly coverage: readonly PricingCoverage[];
}

export type CostCoverageReasonCode =
  | "member-not-recorded"
  | "core-invalid"
  | "origin-run-unavailable"
  | "execution-model-not-recorded"
  | "usage-not-recorded"
  | "usage-unavailable"
  | "usage-migration-required"
  | "usage-unsupported"
  | "usage-invalid"
  | "usage-collection-partial"
  | "pricing-coverage-not-found"
  | "pricing-coverage-unpriced"
  | "pricing-charge-not-found"
  | "observed-cost-other-currency";

export interface CostCoverageReason {
  readonly slot: import("./contracts.ts").AnalysisSlotRef;
  readonly provider: SafeIdentifier | null;
  readonly code: CostCoverageReasonCode;
}

export interface ObservedCostComponent {
  readonly kind: "provider-cost";
  readonly provider: SafeIdentifier;
  readonly currency: CurrencyCode;
  readonly amount: CanonicalDecimal;
}

export interface EstimatedTokenCostComponent {
  readonly kind: "token";
  readonly provider: SafeIdentifier;
  readonly bucket: IndependentlyBillableTokenBucket;
  readonly tokens: number;
  readonly ratePerMillionTokens: CanonicalDecimal;
  readonly amount: CanonicalDecimal;
}

export interface EstimatedRequestCostComponent {
  readonly kind: "request";
  readonly provider: SafeIdentifier;
  readonly requestKind: "model" | "tool";
  readonly ratePerRequest: CanonicalDecimal;
  readonly amount: CanonicalDecimal;
}

export type CostComponent =
  | ObservedCostComponent
  | EstimatedTokenCostComponent
  | EstimatedRequestCostComponent;

export interface ObservedOtherCurrency {
  readonly provider: SafeIdentifier;
  readonly currency: CurrencyCode;
  readonly amount: CanonicalDecimal;
}

/** One Slot/provider branch; observed and estimated facts never mix in it. */
export type CostLedgerEntry =
  | {
      readonly slot: import("./contracts.ts").AnalysisSlotRef;
      readonly provider: SafeIdentifier | null;
      readonly branch: "observed";
      readonly components: readonly [ObservedCostComponent, ...ObservedCostComponent[]];
      readonly estimated: null;
    }
  | {
      readonly slot: import("./contracts.ts").AnalysisSlotRef;
      readonly provider: SafeIdentifier;
      readonly branch: "estimated";
      readonly components: readonly (EstimatedTokenCostComponent | EstimatedRequestCostComponent)[];
      readonly estimated: ProjectedMoney;
    }
  | {
      readonly slot: import("./contracts.ts").AnalysisSlotRef;
      readonly provider: SafeIdentifier | null;
      readonly branch: "unavailable";
      readonly components: readonly [];
      readonly estimated: null;
    };

/** Exact aggregation before any display / Number conversion. */
export type CostProjectionAggregate =
  | {
      readonly kind: "mean";
      /** Canonical USD subtotal before division or display rounding. */
      readonly numerator: CanonicalDecimal;
      /** Slots with a known quote-currency subtotal, never full denominator. */
      readonly denominator: number;
    }
  | {
      readonly kind: "total";
      /** Canonical USD subtotal before display rounding. */
      readonly total: CanonicalDecimal;
    };

interface CostProjectionCommon {
  readonly profile: CostProjectionProfile;
  readonly aggregate: CostProjectionAggregate;
  readonly observedOtherCurrencies: readonly ObservedOtherCurrency[];
  readonly reasons: readonly CostCoverageReason[];
  readonly ledger: readonly CostLedgerEntry[];
}

export interface CostProjectionKnown extends CostProjectionCommon {
  readonly state: "available" | "partial";
  readonly basis: Exclude<CostBasis, "unavailable">;
  readonly observed: ProjectedMoney | null;
  readonly estimated: ProjectedMoney | null;
  readonly combined: ProjectedMoney;
}

export interface CostProjectionUnavailable extends CostProjectionCommon {
  readonly state: "unavailable";
  readonly basis: "unavailable";
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
}

export interface CostProjectionMigrationRequired extends CostProjectionCommon {
  readonly state: "migration-required";
  readonly basis: "unavailable";
  readonly observed: null;
  readonly estimated: null;
  readonly combined: null;
}

export type CostProjectionValue =
  | CostProjectionKnown
  | CostProjectionMigrationRequired
  | CostProjectionUnavailable;

/** A normal MetricValue with a closed cost domain value attached. */
export interface CostMetricValue extends MetricValue<number> {
  readonly state: CostProjectionState;
  readonly format: "currency-usd";
  readonly better: "lower";
  readonly projection: CostProjectionValue;
}

interface CostMeasureDescriptorValue {
  readonly version: 1;
  readonly mode: "mean" | "total";
  readonly profile: PricingProfile;
  readonly profileIdentity: PricingProfileContentIdentity;
}

/** A Measure whose data descriptor binds it to exactly one validated Profile. */
export interface CostMeasure extends Measure<LogicalSlot, number> {
  readonly [CostMeasureDescriptor]: CostMeasureDescriptorValue;
}

type CostMeasureMode = CostMeasureDescriptorValue["mode"];

const utf8 = new TextEncoder();

/** Defines, deeply freezes, canonically sorts, and content-addresses one USD Profile. */
export function definePricingProfile(input: PricingProfileInput): PricingProfile {
  const content = normalizeProfileContent(input);
  const identity = contentIdentityFor(content);
  const descriptor = Object.freeze({
    version: 1 as const,
    contentIdentity: identity,
    content,
  });
  const profile = Object.create(null) as PricingProfile;
  Object.assign(profile, {
    contentIdentity: identity,
    currency: content.currency,
    display: content.display,
    provenance: content.provenance,
    coverage: content.coverage,
  });
  Object.defineProperty(profile, PricingProfileDescriptor, {
    value: descriptor,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(profile);
  validatedPricingProfiles.add(profile);
  return profile;
}

interface BuiltInPriceEntry {
  readonly in: number;
  readonly out: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

const builtInCatalog = loadBuiltInCatalog();

/**
 * Identity-bearing Profile for NiceEval's complete vendored model catalog.
 * Resolution matches an exact model identifier and does not infer a billing
 * provider from an agent name. Missing models and buckets remain unpriced.
 */
export const builtInPricingProfile: PricingProfile = definePricingProfile({
  currency: "USD",
  display: { decimalPlaces: 6, rounding: "half-away-from-zero" },
  provenance: {
    kind: "declared-rate-card",
    source: `NiceEval vendored models.dev catalog ${builtInCatalog.digest}`,
    asOf: builtInCatalog.asOf,
  },
  coverage: [{
    coverageId: `niceeval-catalog-${builtInCatalog.digest.slice("sha256:".length)}`,
    state: "unpriced",
    selector: { model: "niceeval:built-in-catalog" },
    effective: { startsAt: 0, endsAt: null },
    reason: "rate-not-published",
  }],
});

/** @internal Resolves one exact model from the catalog named by the built-in Profile. */
export function builtInPricingCoverage(model: string): PricedCoverage | undefined {
  const price = builtInCatalog.prices[model];
  if (price === undefined) return undefined;
  return normalizeCoverage({
    coverageId: `niceeval-catalog-model-${createHash("sha256").update(model).digest("hex")}`,
    state: "priced",
    selector: { model },
    effective: { startsAt: 0, endsAt: null },
    charges: catalogCharges(price, builtInCatalog.modelRequest),
  }, 0) as PricedCoverage;
}

function catalogCharges(
  price: BuiltInPriceEntry,
  modelRequest: number,
): readonly [PricingChargeInput, ...PricingChargeInput[]] {
  return [
    { kind: "token", bucket: "input", perMillionTokens: decimalFromPrice(price.in) },
    { kind: "token", bucket: "output", perMillionTokens: decimalFromPrice(price.out) },
    ...(price.cacheRead === undefined
      ? []
      : [{ kind: "token" as const, bucket: "cache-read", perMillionTokens: decimalFromPrice(price.cacheRead) }]),
    ...(price.cacheWrite === undefined
      ? []
      : [{ kind: "token" as const, bucket: "cache-write", perMillionTokens: decimalFromPrice(price.cacheWrite) }]),
    { kind: "request", requestKind: "model", ratePerRequest: decimalFromPrice(modelRequest) },
  ];
}

function loadBuiltInCatalog(): {
  readonly digest: string;
  readonly asOf: number;
  readonly modelRequest: number;
  readonly prices: Record<string, BuiltInPriceEntry>;
} {
  const raw = readFileSync(fileURLToPath(new URL("../o11y/prices.json", import.meta.url)), "utf8");
  const parsed = JSON.parse(raw) as {
    readonly $asOf?: number;
    readonly $modelRequest?: number;
    readonly prices?: Record<string, BuiltInPriceEntry>;
  };
  if (parsed.prices === undefined || Object.keys(parsed.prices).length === 0 ||
    typeof parsed.$asOf !== "number" || !isUtcMillis(parsed.$asOf) ||
    typeof parsed.$modelRequest !== "number") {
    throw pricingError("built-in pricing catalog metadata is invalid");
  }
  return Object.freeze({
    digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    asOf: parsed.$asOf,
    modelRequest: parsed.$modelRequest,
    prices: parsed.prices,
  });
}

function decimalFromPrice(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw pricingError("built-in catalog price must be non-negative and finite");
  const decimal = String(value);
  if (!isCanonicalDecimal(decimal)) throw pricingError(`built-in catalog price ${decimal} is not canonical`);
  return decimal;
}

/** @internal
 * Locally created or already revalidated Profiles use a WeakSet fast path.
 * A value from another package graph must first pass the global Symbol data
 * descriptor, recursive freezing, canonical content, and SHA-256 checks.
 */
export function isPricingProfile(value: unknown): value is PricingProfile {
  if (typeof value === "object" && value !== null && validatedPricingProfiles.has(value)) return true;
  if (!isPlainObject(value) || !isDeeplyFrozen(value)) return false;
  if (!hasExactOwnKeys(value, ["contentIdentity", "currency", "display", "provenance", "coverage"], [PricingProfileDescriptor])) {
    return false;
  }
  const descriptor = dataDescriptorValue<PricingProfileDescriptorValue>(value, PricingProfileDescriptor);
  if (descriptor === undefined || !isDeeplyFrozen(descriptor)) return false;
  if (!hasExactOwnKeys(descriptor, ["version", "contentIdentity", "content"])) return false;
  try {
    if (descriptor.version !== 1 || typeof value.contentIdentity !== "string") return false;
    if (value.contentIdentity !== descriptor.contentIdentity) return false;
    const content = normalizeProfileContent({
      currency: value.currency,
      display: value.display,
      provenance: value.provenance,
      coverage: value.coverage,
    });
    if (canonicalJson(content) !== canonicalJson(descriptor.content)) return false;
    if (contentIdentityFor(content) !== value.contentIdentity) return false;
    validatedPricingProfiles.add(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @internal Validates one already-closed cost projection without rebuilding a
 * price, a ledger, or a numeric result. Report imports this internal guard so
 * every deep cost-domain rule remains owned by Analysis.
 */
export function isCostProjectionValue(value: unknown): value is CostProjectionValue {
  if (!isPlainObject(value) || !isDeeplyFrozen(value) || !hasExactOwnKeys(value, COST_PROJECTION_FIELDS)) {
    return false;
  }
  const projection = value as Readonly<Record<string, unknown>>;
  const profile = projection.profile;
  if (!isClosedCostProjectionProfile(profile) || !isCostProjectionAggregate(projection.aggregate) ||
    !isClosedDataArray(projection.observedOtherCurrencies) ||
    !projection.observedOtherCurrencies.every(isObservedOtherCurrency) ||
    !isClosedDataArray(projection.reasons) || !projection.reasons.every(isCostCoverageReason) ||
    !isClosedDataArray(projection.ledger) ||
    !projection.ledger.every((entry) => isCostLedgerEntry(entry, profile))) {
    return false;
  }
  if (projection.state === "unavailable" || projection.state === "migration-required") {
    if (projection.basis !== "unavailable" || projection.observed !== null ||
      projection.estimated !== null || projection.combined !== null) return false;
    if (projection.state === "unavailable") return true;
    const ledger = projection.ledger as readonly CostLedgerEntry[];
    const reasons = projection.reasons as readonly CostCoverageReason[];
    return ledger.length > 0 &&
      ledger.every((entry) => entry.branch === "unavailable" && reasons.some((reason) =>
        reason.code === "usage-migration-required" &&
        reason.slot.runId === entry.slot.runId &&
        reason.slot.slotId === entry.slot.slotId
      ));
  }
  if (projection.state !== "available" && projection.state !== "partial" ||
    !isNullableProjectedMoney(projection.observed, profile) ||
    !isNullableProjectedMoney(projection.estimated, profile) ||
    !isProjectedMoney(projection.combined, profile)) {
    return false;
  }
  return projection.observed !== null && projection.estimated !== null
    ? projection.basis === "mixed"
    : projection.observed !== null
    ? projection.basis === "observed"
    : projection.estimated !== null && projection.basis === "estimated";
}

const COST_PROJECTION_FIELDS = Object.freeze([
  "state",
  "basis",
  "profile",
  "aggregate",
  "observedOtherCurrencies",
  "reasons",
  "ledger",
  "observed",
  "estimated",
  "combined",
] as const);

const COST_COVERAGE_REASON_CODES = new Set<CostCoverageReason["code"]>([
  "member-not-recorded",
  "core-invalid",
  "origin-run-unavailable",
  "execution-model-not-recorded",
  "usage-not-recorded",
  "usage-unavailable",
  "usage-migration-required",
  "usage-unsupported",
  "usage-invalid",
  "usage-collection-partial",
  "pricing-coverage-not-found",
  "pricing-coverage-unpriced",
  "pricing-charge-not-found",
  "observed-cost-other-currency",
]);

/** The projection profile is descriptor-free data, so canonicalize it here. */
function isClosedCostProjectionProfile(value: unknown): value is CostProjectionProfile {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, ["contentIdentity", "currency", "display", "provenance", "coverage"])) {
    return false;
  }
  const profile = value as Readonly<Record<string, unknown>>;
  if (typeof profile.contentIdentity !== "string") return false;
  try {
    const content = normalizeProfileContent({
      currency: profile.currency,
      display: profile.display,
      provenance: profile.provenance,
      coverage: profile.coverage,
    });
    const supplied = Object.freeze({
      version: 1,
      currency: profile.currency,
      display: profile.display,
      provenance: profile.provenance,
      coverage: profile.coverage,
    });
    return canonicalJson(content) === canonicalJson(supplied) &&
      contentIdentityFor(content) === profile.contentIdentity;
  } catch {
    return false;
  }
}

function isCostProjectionAggregate(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.kind === "mean") {
    return hasExactOwnKeys(value, ["kind", "numerator", "denominator"]) &&
      isCanonicalDecimalValue(value.numerator) && isNonNegativeSafeInteger(value.denominator);
  }
  return value.kind === "total" && hasExactOwnKeys(value, ["kind", "total"]) &&
    isCanonicalDecimalValue(value.total);
}

function isNullableProjectedMoney(value: unknown, profile: CostProjectionProfile): boolean {
  return value === null || isProjectedMoney(value, profile);
}

function isProjectedMoney(value: unknown, profile: CostProjectionProfile): boolean {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, ["amount", "currency", "decimalPlaces"])) return false;
  return isCanonicalDecimalValue(value.amount) && value.currency === profile.currency &&
    typeof value.currency === "string" && isCurrencyCode(value.currency) &&
    value.decimalPlaces === profile.display.decimalPlaces;
}

function isObservedOtherCurrency(value: unknown): boolean {
  return isPlainObject(value) && hasExactOwnKeys(value, ["provider", "currency", "amount"]) &&
    typeof value.provider === "string" && isSafeIdentifier(value.provider) &&
    typeof value.currency === "string" && isCurrencyCode(value.currency) && isCanonicalDecimalValue(value.amount);
}

function isCostCoverageReason(value: unknown): boolean {
  return isPlainObject(value) && hasExactOwnKeys(value, ["slot", "provider", "code"]) &&
    isAnalysisSlotRef(value.slot) &&
    (value.provider === null || (typeof value.provider === "string" && isSafeIdentifier(value.provider))) &&
    typeof value.code === "string" && COST_COVERAGE_REASON_CODES.has(value.code as CostCoverageReason["code"]);
}

function isCostLedgerEntry(value: unknown, profile: CostProjectionProfile): boolean {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, ["slot", "provider", "branch", "components", "estimated"]) ||
    !isAnalysisSlotRef(value.slot) || !isClosedDataArray(value.components)) {
    return false;
  }
  if (value.branch === "observed") {
    const provider = value.provider;
    if (typeof provider !== "string" || !isSafeIdentifier(provider) ||
      value.estimated !== null || value.components.length === 0) return false;
    return value.components.every((component) => isObservedCostComponent(component, provider));
  }
  if (value.branch === "estimated") {
    const provider = value.provider;
    if (typeof provider !== "string" || !isSafeIdentifier(provider) ||
      value.components.length === 0 || !isProjectedMoney(value.estimated, profile)) return false;
    return value.components.every((component) => isEstimatedCostComponent(component, provider));
  }
  return value.branch === "unavailable" &&
    (value.provider === null || (typeof value.provider === "string" && isSafeIdentifier(value.provider))) &&
    value.components.length === 0 && value.estimated === null;
}

function isObservedCostComponent(value: unknown, provider: string): boolean {
  return isPlainObject(value) && hasExactOwnKeys(value, ["kind", "provider", "currency", "amount"]) &&
    value.kind === "provider-cost" && value.provider === provider &&
    typeof value.currency === "string" && isCurrencyCode(value.currency) && isCanonicalDecimalValue(value.amount);
}

function isEstimatedCostComponent(value: unknown, provider: string): boolean {
  if (!isPlainObject(value)) return false;
  if (value.kind === "token") {
    return hasExactOwnKeys(value, ["kind", "provider", "bucket", "tokens", "ratePerMillionTokens", "amount"]) &&
      value.provider === provider && typeof value.bucket === "string" && isIndependentlyBillableTokenBucket(value.bucket) &&
      isNonNegativeSafeInteger(value.tokens) && isCanonicalDecimalValue(value.ratePerMillionTokens) &&
      isCanonicalDecimalValue(value.amount);
  }
  return value.kind === "request" &&
    hasExactOwnKeys(value, ["kind", "provider", "requestKind", "ratePerRequest", "amount"]) &&
    value.provider === provider && (value.requestKind === "model" || value.requestKind === "tool") &&
    isCanonicalDecimalValue(value.ratePerRequest) && isCanonicalDecimalValue(value.amount);
}

function isAnalysisSlotRef(value: unknown): boolean {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, [
    "runId",
    "slotId",
    "experimentId",
    "evalId",
    "attemptOrdinal",
    "executionIdentityDigest",
  ])) return false;
  return typeof value.runId === "string" && isPortableSegment(value.runId) &&
    typeof value.slotId === "string" && isPortableSegment(value.slotId) &&
    typeof value.experimentId === "string" && isRecordDomainIdentity(value.experimentId) &&
    typeof value.evalId === "string" && isRecordDomainIdentity(value.evalId) &&
    isNonNegativeSafeInteger(value.attemptOrdinal) &&
    typeof value.executionIdentityDigest === "string" && isSha256Digest(value.executionIdentityDigest);
}

function isClosedDataArray(value: unknown): value is readonly unknown[] {
  try {
    dataArrayValues(value, "CostProjection");
    return true;
  } catch {
    return false;
  }
}

function isCanonicalDecimalValue(value: unknown): value is CanonicalDecimal {
  return typeof value === "string" && isCanonicalDecimal(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Mean known USD cost per logical Slot for exactly one Profile. */
export function costUSD(profile: PricingProfile): CostMeasure {
  return defineCostMeasure(profile, "mean");
}

/** Total known USD cost across logical Slots for exactly one Profile. */
export function totalCostUSD(profile: PricingProfile): CostMeasure {
  return defineCostMeasure(profile, "total");
}

/** @internal Revalidates a local or external CostMeasure data descriptor. */
export function costMeasureState(value: unknown): CostMeasureDescriptorValue | undefined {
  if (!isPlainObject(value) || !isDeeplyFrozen(value)) return undefined;
  const descriptor = dataDescriptorValue<CostMeasureDescriptorValue>(value, CostMeasureDescriptor);
  if (descriptor === undefined || !isDeeplyFrozen(descriptor)) return undefined;
  if (!hasExactOwnKeys(descriptor, ["version", "mode", "profile", "profileIdentity"])) return undefined;
  if (descriptor.version !== 1 || (descriptor.mode !== "mean" && descriptor.mode !== "total")) return undefined;
  if (!isPricingProfile(descriptor.profile) || descriptor.profile.contentIdentity !== descriptor.profileIdentity) return undefined;
  if (value.kind !== "measure" || typeof value.id !== "string") return undefined;
  const expectedId = descriptor.mode === "mean"
    ? `niceeval.cost-usd:${descriptor.profileIdentity}`
    : `niceeval.total-cost-usd:${descriptor.profileIdentity}`;
  if (value.id !== expectedId) return undefined;
  return descriptor;
}

/** @internal A structural cross-instance guard; it never infers a Profile from `id`. */
export function isCostMeasure(value: unknown): value is CostMeasure {
  return costMeasureState(value) !== undefined;
}

/** @internal Closes only immutable profile data for renderer consumption. */
export function closeCostProjectionProfile(profile: PricingProfile): CostProjectionProfile {
  assertPricingProfile(profile);
  return Object.freeze({
    contentIdentity: profile.contentIdentity,
    currency: profile.currency as CurrencyCode,
    display: profile.display,
    provenance: profile.provenance,
    coverage: profile.coverage,
  });
}

/** @internal Tests immutable Attempt-origin Core facts against a Profile coverage. */
export function pricingCoverageMatches(
  coverage: PricingCoverage,
  input: {
    readonly provider: SafeIdentifier;
    readonly origin: {
      readonly startedAt: UtcMillis;
      readonly executionIdentityDigest: ExecutionIdentityDigest;
      readonly execution: {
        readonly agentId: string;
        readonly model: string | null;
        readonly reasoningEffort: string | null;
      };
    };
  },
): boolean {
  const selector = coverage.selector;
  return (selector.provider === undefined || selector.provider === input.provider)
    && selector.model === input.origin.execution.model
    && (selector.agentId === undefined || selector.agentId === input.origin.execution.agentId)
    && (selector.reasoningEffort === undefined || selector.reasoningEffort === input.origin.execution.reasoningEffort)
    && (selector.executionIdentityDigest === undefined || selector.executionIdentityDigest === input.origin.executionIdentityDigest)
    && input.origin.startedAt >= coverage.effective.startsAt
    && (coverage.effective.endsAt === null || input.origin.startedAt < coverage.effective.endsAt);
}

function defineCostMeasure(profile: PricingProfile, mode: CostMeasureMode): CostMeasure {
  assertPricingProfile(profile);
  const base = createOpaqueMeasure<LogicalSlot, number>({
    id: mode === "mean"
      ? `niceeval.cost-usd:${profile.contentIdentity}`
      : `niceeval.total-cost-usd:${profile.contentIdentity}`,
    population: logicalSlots,
    format: "currency-usd",
    better: "lower",
  });
  const descriptor = Object.freeze({
    version: 1 as const,
    mode,
    profile,
    profileIdentity: profile.contentIdentity,
  });
  const measure = { ...base } as CostMeasure;
  Object.defineProperty(measure, CostMeasureDescriptor, {
    value: descriptor,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(measure);
  return measure;
}

function assertPricingProfile(value: unknown): asserts value is PricingProfile {
  if (!isPricingProfile(value)) throw pricingError("cost measures require a validated PricingProfile");
}

function normalizeProfileContent(input: unknown): PricingProfileCanonicalContent {
  requireExactObject(input, ["currency", "display", "provenance", "coverage"], "PricingProfile");
  if (input.currency !== "USD" || !isCurrencyCode(input.currency)) {
    throw pricingError("currency must be USD in v1");
  }
  const coverageInput = dataArrayValues(input.coverage, "PricingProfile coverage");
  if (coverageInput.length === 0) {
    throw pricingError("coverage must be a non-empty array");
  }
  const coverage = coverageInput.map((value, index) => normalizeCoverage(value, index));
  const coverageIds = new Set<string>();
  for (const value of coverage) {
    if (coverageIds.has(value.coverageId)) throw pricingError(`coverageId ${value.coverageId} is duplicated`);
    coverageIds.add(value.coverageId);
  }
  rejectOverlappingCoverage(coverage);
  return Object.freeze({
    version: 1 as const,
    currency: "USD" as const,
    display: normalizeDisplay(input.display),
    provenance: normalizeProvenance(input.provenance),
    coverage: Object.freeze([...coverage].sort(compareCoverage)),
  });
}

function normalizeDisplay(value: unknown): PricingDisplay {
  requireExactObject(value, ["decimalPlaces", "rounding"], "PricingProfile display");
  if (typeof value.decimalPlaces !== "number" || !Number.isSafeInteger(value.decimalPlaces) || value.decimalPlaces < 0 || value.decimalPlaces > 9) {
    throw pricingError("display decimalPlaces must be an integer from 0 through 9");
  }
  if (value.rounding !== "half-away-from-zero") {
    throw pricingError("display rounding must be half-away-from-zero");
  }
  return Object.freeze({
    decimalPlaces: value.decimalPlaces as PricingDisplay["decimalPlaces"],
    rounding: value.rounding,
  });
}

function normalizeProvenance(value: unknown): PricingProvenance {
  requireExactObject(value, ["kind", "source", "asOf"], "PricingProfile provenance");
  if (value.kind !== "declared-rate-card") {
    throw pricingError("provenance kind must be declared-rate-card");
  }
  return Object.freeze({
    kind: "declared-rate-card" as const,
    source: normalizeText(value.source, "provenance source"),
    asOf: normalizeUtcMillis(value.asOf, "provenance asOf"),
  });
}

function normalizeCoverage(value: unknown, index: number): PricingCoverage {
  if (!isPlainObject(value)) throw pricingError(`coverage ${index} must be a plain object`);
  const state = ownDataValue(value, "state", `coverage ${index}`);
  if (state === "priced") {
    requireExactObject(value, ["coverageId", "state", "selector", "effective", "charges"], `coverage ${index}`);
    const chargesInput = dataArrayValues(value.charges, `coverage ${index} priced charges`);
    if (chargesInput.length === 0) {
      throw pricingError(`coverage ${index} priced charges must be non-empty`);
    }
    const charges = chargesInput.map((charge, chargeIndex) => normalizeCharge(charge, index, chargeIndex));
    const chargeKeys = new Set<string>();
    for (const charge of charges) {
      const key = charge.kind === "token" ? `token:${charge.bucket}` : `request:${charge.requestKind}`;
      if (chargeKeys.has(key)) throw pricingError(`coverage ${index} has duplicate ${key} charge`);
      chargeKeys.add(key);
    }
    return Object.freeze({
      coverageId: normalizeCoverageId(value.coverageId, index),
      state: "priced" as const,
      selector: normalizeSelector(value.selector, index),
      effective: normalizeEffective(value.effective, index),
      charges: Object.freeze([...charges].sort(compareCharge)) as readonly [PricingCharge, ...PricingCharge[]],
    });
  }
  if (state === "unpriced") {
    requireExactObject(value, ["coverageId", "state", "selector", "effective", "reason"], `coverage ${index}`);
    if (value.reason !== "provider-not-priced" && value.reason !== "billing-mode-not-priced" && value.reason !== "rate-not-published") {
      throw pricingError(`coverage ${index} has an unrecognized unpriced reason`);
    }
    return Object.freeze({
      coverageId: normalizeCoverageId(value.coverageId, index),
      state: "unpriced" as const,
      selector: normalizeSelector(value.selector, index),
      effective: normalizeEffective(value.effective, index),
      reason: value.reason,
    });
  }
  throw pricingError(`coverage ${index} state must be priced or unpriced`);
}

function normalizeCoverageId(value: unknown, index: number): PricingCoverageId {
  return normalizeText(value, `coverage ${index} coverageId`) as PricingCoverageId;
}

function normalizeSelector(value: unknown, index: number): PricingSelector {
  requireExactObject(
    value,
    ["provider", "model", "agentId", "reasoningEffort", "executionIdentityDigest"],
    `coverage ${index} selector`,
    ["provider", "agentId", "reasoningEffort", "executionIdentityDigest"],
  );
  if (value.provider !== undefined && (typeof value.provider !== "string" || !isSafeIdentifier(value.provider))) {
    throw pricingError(`coverage ${index} selector provider must be a SafeIdentifier`);
  }
  return Object.freeze({
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    model: normalizeText(value.model, `coverage ${index} selector model`),
    ...(value.agentId === undefined
      ? {}
      : { agentId: normalizeText(value.agentId, `coverage ${index} selector agentId`) }),
    ...(value.reasoningEffort === undefined
      ? {}
      : value.reasoningEffort === null
      ? { reasoningEffort: null }
      : { reasoningEffort: normalizeText(value.reasoningEffort, `coverage ${index} selector reasoningEffort`) }),
    ...(value.executionIdentityDigest === undefined
      ? {}
      : { executionIdentityDigest: normalizeExecutionIdentityDigest(value.executionIdentityDigest, index) }),
  });
}

function normalizeExecutionIdentityDigest(value: unknown, index: number): ExecutionIdentityDigest {
  if (typeof value !== "string" || !isSha256Digest(value)) {
    throw pricingError(`coverage ${index} selector executionIdentityDigest must be SHA-256 hex`);
  }
  return value as ExecutionIdentityDigest;
}

function normalizeEffective(value: unknown, index: number): PricingEffectiveCondition {
  requireExactObject(value, ["startsAt", "endsAt"], `coverage ${index} effective`);
  const startsAt = normalizeUtcMillis(value.startsAt, `coverage ${index} effective startsAt`);
  const endsAt = value.endsAt === null ? null : normalizeUtcMillis(value.endsAt, `coverage ${index} effective endsAt`);
  if (endsAt !== null && endsAt <= startsAt) {
    throw pricingError(`coverage ${index} effective endsAt must be after startsAt`);
  }
  return Object.freeze({ startsAt, endsAt });
}

function normalizeCharge(value: unknown, coverageIndex: number, chargeIndex: number): PricingCharge {
  if (!isPlainObject(value)) throw pricingError(`coverage ${coverageIndex} charge ${chargeIndex} must be a plain object`);
  const kind = ownDataValue(value, "kind", `coverage ${coverageIndex} charge ${chargeIndex}`);
  if (kind === "token") {
    requireExactObject(value, ["kind", "bucket", "perMillionTokens"], `coverage ${coverageIndex} charge ${chargeIndex}`);
    if (typeof value.bucket !== "string" || !isIndependentlyBillableTokenBucket(value.bucket)) {
      throw pricingError(
        `coverage ${coverageIndex} charge ${chargeIndex} token bucket must be one of ${INDEPENDENTLY_BILLABLE_TOKEN_BUCKETS.join(", ")}`,
      );
    }
    return Object.freeze({
      kind: "token" as const,
      bucket: value.bucket,
      perMillionTokens: normalizeDecimal(value.perMillionTokens, coverageIndex, chargeIndex, "perMillionTokens"),
    });
  }
  if (kind === "request") {
    requireExactObject(value, ["kind", "requestKind", "ratePerRequest"], `coverage ${coverageIndex} charge ${chargeIndex}`);
    if (value.requestKind !== "model" && value.requestKind !== "tool") {
      throw pricingError(`coverage ${coverageIndex} charge ${chargeIndex} requestKind must be model or tool`);
    }
    return Object.freeze({
      kind: "request" as const,
      requestKind: value.requestKind,
      ratePerRequest: normalizeDecimal(value.ratePerRequest, coverageIndex, chargeIndex, "ratePerRequest"),
    });
  }
  throw pricingError(`coverage ${coverageIndex} charge ${chargeIndex} kind must be token or request`);
}

function normalizeDecimal(value: unknown, coverageIndex: number, chargeIndex: number, field: string): CanonicalDecimal {
  if (typeof value !== "string" || !isCanonicalDecimal(value)) {
    throw pricingError(`coverage ${coverageIndex} charge ${chargeIndex} ${field} must be canonical decimal`);
  }
  return value as CanonicalDecimal;
}

function normalizeUtcMillis(value: unknown, name: string): UtcMillis {
  if (typeof value !== "number" || !isUtcMillis(value)) throw pricingError(`${name} must be UTC milliseconds`);
  return value as UtcMillis;
}

function normalizeText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || !isStrictUnicodeText(value) || utf8ByteLength(value) > 8_192) {
    throw pricingError(`${name} must be non-empty, trimmed, bounded Unicode text`);
  }
  return value;
}

function rejectOverlappingCoverage(coverage: readonly PricingCoverage[]): void {
  const byModel = new Map<string, PricingCoverage[]>();
  for (const entry of coverage) {
    const entries = byModel.get(entry.selector.model);
    if (entries === undefined) byModel.set(entry.selector.model, [entry]);
    else entries.push(entry);
  }
  for (const entries of byModel.values()) {
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const first = entries[left]!;
        const second = entries[right]!;
        if (selectorsCanMatchSameOrigin(first.selector, second.selector) && effectiveIntervalsOverlap(first.effective, second.effective)) {
          throw pricingError(`coverage ${first.coverageId} overlaps ${second.coverageId} for a selector that can match the same origin`);
        }
      }
    }
  }
}

function selectorsCanMatchSameOrigin(left: PricingSelector, right: PricingSelector): boolean {
  return optionalSelectorDimensionOverlaps(left.provider, right.provider)
    && left.model === right.model
    && optionalSelectorDimensionOverlaps(left.agentId, right.agentId)
    && optionalSelectorDimensionOverlaps(left.reasoningEffort, right.reasoningEffort)
    && optionalSelectorDimensionOverlaps(left.executionIdentityDigest, right.executionIdentityDigest);
}

function optionalSelectorDimensionOverlaps<Value>(left: Value | undefined, right: Value | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}

function effectiveIntervalsOverlap(left: PricingEffectiveCondition, right: PricingEffectiveCondition): boolean {
  const latestStart = left.startsAt > right.startsAt ? left.startsAt : right.startsAt;
  const earliestEnd = left.endsAt === null
    ? right.endsAt
    : right.endsAt === null
    ? left.endsAt
    : left.endsAt < right.endsAt ? left.endsAt : right.endsAt;
  return earliestEnd === null || latestStart < earliestEnd;
}

function contentIdentityFor(content: PricingProfileCanonicalContent): PricingProfileContentIdentity {
  return `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}` as PricingProfileContentIdentity;
}

function compareCoverage(left: PricingCoverage, right: PricingCoverage): number {
  return compareUtf8(canonicalJson(left), canonicalJson(right));
}

function compareCharge(left: PricingCharge, right: PricingCharge): number {
  const leftKey = left.kind === "token" ? `token:${left.bucket}` : `request:${left.requestKind}`;
  const rightKey = right.kind === "token" ? `token:${right.bucket}` : `request:${right.requestKind}`;
  return compareUtf8(leftKey, rightKey);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return canonicalArrayJson(value);
  if (!isPlainObject(value)) throw pricingError("canonical Profile content must be JSON data");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw pricingError("canonical Profile content cannot contain Symbol fields");
  }
  return `{${(keys as string[])
    .sort(compareUtf8)
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw pricingError("canonical Profile content must use enumerable data fields");
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`;
    })
    .join(",")}}`;
}

function canonicalArrayJson(value: readonly unknown[]): string {
  return `[${dataArrayValues(value, "canonical Profile array").map(canonicalJson).join(",")}]`;
}

function dataArrayValues(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw pricingError(`${name} must be a normal array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  // A canonical JSON array has exactly its dense integer data fields and the
  // built-in length field.  A frozen array can otherwise still carry hidden
  // strings, Symbols, holes, or accessors that identity encoding would miss.
  if (ownKeys.length !== value.length + 1) {
    throw pricingError(`${name} has extra fields or holes`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.enumerable || lengthDescriptor.value !== value.length) {
    throw pricingError(`${name} has an invalid length field`);
  }
  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw pricingError(`${name} must be dense data`);
    }
    values.push(descriptor.value);
  }
  return Object.freeze(values);
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const first = utf8.encode(left);
  const second = utf8.encode(right);
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

function requireExactObject(
  value: unknown,
  keys: readonly string[],
  name: string,
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw pricingError(`${name} must be a plain object`);
  const allowed = new Set(keys);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) throw pricingError(`${name} has an unknown Symbol field`);
  const actual = Object.getOwnPropertyNames(value);
  if (actual.some((key) => !allowed.has(key))) throw pricingError(`${name} has an unknown field`);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw pricingError(`${name} field ${key} must be an enumerable data property`);
    }
  }
  for (const key of keys) {
    if (!optional.includes(key) && !Object.hasOwn(value, key)) throw pricingError(`${name} is missing ${key}`);
  }
}

function ownDataValue(value: Record<string, unknown>, key: string, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    throw pricingError(`${name} is missing enumerable data field ${key}`);
  }
  return descriptor.value;
}

function hasExactOwnKeys(
  value: object,
  stringKeys: readonly string[],
  symbolKeys: readonly symbol[] = [],
): boolean {
  const actualStrings = Object.getOwnPropertyNames(value).sort(compareUtf8);
  const expectedStrings = [...stringKeys].sort(compareUtf8);
  if (actualStrings.length !== expectedStrings.length || actualStrings.some((key, index) => key !== expectedStrings[index])) return false;
  if (stringKeys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable;
  })) return false;
  const actualSymbols = Object.getOwnPropertySymbols(value);
  return actualSymbols.length === symbolKeys.length && symbolKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return actualSymbols.includes(key) && descriptor !== undefined && "value" in descriptor && !descriptor.enumerable;
  });
}

function dataDescriptorValue<Value>(value: object, key: symbol): Value | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) return undefined;
  return descriptor.value as Value;
}

function isDeeplyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null) return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
    if (!isDeeplyFrozen(descriptor.value, seen)) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pricingError(message: string): Error {
  return new TypeError(`PricingProfile invalid: ${message}`);
}
