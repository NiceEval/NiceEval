import type { AttemptObservabilityAttachment } from "../record/family/observability.ts";
import type { RecordAttachmentPayloadSnapshot } from "../record/attachment/types.ts";
import type {
  CanonicalDecimal,
  CurrencyCode,
  NonNegativeSafeInteger,
  SafeIdentifier,
} from "../o11y/record/model.ts";
import {
  makeCanonicalDecimal,
  makeCurrencyCode,
  makeNonNegativeSafeInteger,
  makeSafeIdentifier,
} from "../o11y/record/model.ts";
import type { ClosedAttemptCore } from "./domain-view.ts";
import type { LogicalSlot } from "./definitions.ts";
import type { AnalysisSlotRef, EvidenceRef } from "./contracts.ts";
import {
  addDecimalCoefficients,
  costForPerMillionTokens,
  divideDecimalCoefficient,
  multiplyCanonicalDecimalByInteger,
  normalizeCanonicalDecimal,
  parseCanonicalDecimal,
  rationalFromDecimal,
  roundDecimalRationalHalfAway,
  type DecimalCoefficient,
} from "./cost-decimal.ts";
import {
  builtInPricingCoverage,
  builtInPricingProfile,
  closeCostProjectionProfile,
  pricingCoverageMatches,
  type CostBasis,
  type CostCoverageReason,
  type CostLedgerEntry,
  type CostProjectionValue,
  type CostComponent,
  type EstimatedRequestCostComponent,
  type EstimatedTokenCostComponent,
  type ObservedCostComponent,
  type ObservedOtherCurrency,
  type PricingCharge,
  type PricingCoverage,
  type PricingProfile,
  type ProjectedMoney,
} from "./cost.ts";

/** @internal One raw, Sample-local Slot closure before group aggregation. */
export interface CostSlotProjection {
  readonly slot: AnalysisSlotRef;
  readonly complete: boolean;
  readonly observed: readonly ObservedOtherCurrency[];
  readonly estimated: readonly CanonicalDecimal[];
  readonly reasons: readonly CostCoverageReason[];
  readonly ledger: readonly CostLedgerEntry[];
  readonly refs: readonly EvidenceRef[];
}

type UsageSnapshot = RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>["usage"];

/** @internal Builds a missing denominator Slot without inventing a provider. */
export function unavailableCostSlot(
  member: LogicalSlot,
  code: Extract<CostCoverageReason["code"], "member-not-recorded" | "core-invalid" | "origin-run-unavailable" | "usage-not-recorded" | "usage-unavailable" | "usage-migration-required" | "usage-unsupported" | "usage-invalid">,
  refs: readonly EvidenceRef[] = [],
): CostSlotProjection {
  const slot = closeSlot(member);
  const reason = costReason(slot, null, code);
  return Object.freeze({
    slot,
    complete: false,
    observed: Object.freeze([]),
    estimated: Object.freeze([]),
    reasons: Object.freeze([reason]),
    ledger: Object.freeze([
      Object.freeze({
        slot,
        provider: null,
        branch: "unavailable" as const,
        components: Object.freeze([]) as readonly [],
        estimated: null,
      }),
    ]),
    refs: freezeRefs(refs),
  });
}

/** @internal Closes one available Usage family with origin-only profile matching. */
export function projectCostUsage(input: {
  readonly member: LogicalSlot;
  readonly core: ClosedAttemptCore;
  readonly usage: UsageSnapshot;
  readonly profile: PricingProfile;
  readonly refs: readonly EvidenceRef[];
}): CostSlotProjection {
  const slot = closeSlot(input.member);
  type UsageObservation = UsageSnapshot["observations"][number];
  const byProvider = new Map<SafeIdentifier, UsageObservation[]>();
  for (const observation of input.usage.observations) {
    const provider = requiredSafeIdentifier(observation.provider, "Usage provider");
    const entries = byProvider.get(provider);
    if (entries === undefined) byProvider.set(provider, [observation]);
    else entries.push(observation);
  }
  const observed: ObservedOtherCurrency[] = [];
  const estimated: CanonicalDecimal[] = [];
  const reasons: CostCoverageReason[] = [];
  const ledger: CostLedgerEntry[] = [];
  let complete = input.usage.collection.state === "complete";
  if (!complete) reasons.push(costReason(slot, null, "usage-collection-partial"));

  for (const [provider, observations] of [...byProvider.entries()].sort(compareProviderEntry)) {
    const providerCosts = observations.filter((observation) => observation.kind === "provider-cost");
    if (providerCosts.length > 0) {
      const components = Object.freeze(providerCosts
        .map((observation) => Object.freeze({
          kind: "provider-cost" as const,
          provider,
          currency: requiredCurrencyCode(observation.currency, "Usage provider-cost currency"),
          amount: requiredCanonicalDecimal(observation.amount, "Usage provider-cost amount"),
        }))
        .sort(compareComponent)) as readonly [ObservedCostComponent, ...ObservedCostComponent[]];
      observed.push(...components.map((component) => Object.freeze({
        provider: component.provider,
        currency: component.currency,
        amount: component.amount,
      })));
      if (components.some((entry) => entry.currency !== input.profile.currency)) {
        complete = false;
        reasons.push(costReason(slot, provider, "observed-cost-other-currency"));
      }
      ledger.push(Object.freeze({
        slot,
        provider,
        branch: "observed" as const,
        components,
        estimated: null,
      }));
      continue;
    }

    if (input.core.origin.execution.model === null) {
      complete = false;
      reasons.push(costReason(slot, provider, "execution-model-not-recorded"));
      ledger.push(unavailableLedger(slot, provider));
      continue;
    }

    const coverage = matchingCoverage(input.profile, provider, input.core);
    if (coverage === undefined) {
      complete = false;
      reasons.push(costReason(slot, provider, "pricing-coverage-not-found"));
      ledger.push(unavailableLedger(slot, provider));
      continue;
    }
    if (coverage.state === "unpriced") {
      complete = false;
      reasons.push(costReason(slot, provider, "pricing-coverage-unpriced"));
      ledger.push(unavailableLedger(slot, provider));
      continue;
    }

    const priced = estimateProvider(slot, provider, observations, coverage, reasons);
    if (!priced.complete || priced.components.length === 0) {
      complete = false;
      if (priced.components.length === 0 && !reasons.some((reason) =>
        reason.slot === slot && reason.provider === provider && reason.code === "pricing-charge-not-found"
      )) {
        reasons.push(costReason(slot, provider, "pricing-charge-not-found"));
      }
      ledger.push(unavailableLedger(slot, provider));
      continue;
    }
    estimated.push(priced.amount);
    ledger.push(Object.freeze({
      slot,
      provider,
      branch: "estimated" as const,
      components: priced.components,
      estimated: projectedMoneyFromDecimal(input.profile, parseCanonicalDecimal(priced.amount)),
    }));
  }

  if (byProvider.size === 0) {
    complete = false;
    reasons.push(costReason(slot, null, "usage-unavailable"));
    ledger.push(unavailableLedger(slot, null));
  }
  return Object.freeze({
    slot,
    complete,
    observed: Object.freeze([...observed].sort(compareObserved)),
    estimated: Object.freeze([...estimated]),
    reasons: freezeReasons(reasons),
    ledger: Object.freeze([...ledger].sort(compareLedger)),
    refs: freezeRefs(input.refs),
  });
}

/** @internal Exactly reduces closed raw Slot data for one requested cost Measure. */
export function aggregateCostProjection(
  profile: PricingProfile,
  slots: readonly CostSlotProjection[],
  mode: "mean" | "total",
): {
  readonly projection: CostProjectionValue;
  readonly samples: number;
  readonly total: number;
  readonly refs: readonly EvidenceRef[];
  readonly value: number | null;
} {
  // A provider-cost coordinate is only a known USD subtotal when every
  // observed component in that locked coordinate is USD.  Keeping a USD
  // fragment beside an unconvertible currency would fabricate a partial
  // provider invoice rather than close the observed branch faithfully.
  const observedQuote = slots.flatMap((slot) => slot.ledger.flatMap((entry) =>
    entry.branch !== "observed" || entry.components.some((component) => component.currency !== profile.currency)
      ? []
      : entry.components.map((component) => component.amount)
  ));
  const estimatedQuote = slots.flatMap((slot) => slot.estimated);
  const contributingSlots = slots.filter((slot) => slotHasQuoteAmount(slot, profile.currency));
  const observedTotal = exactSum(observedQuote);
  const estimatedTotal = exactSum(estimatedQuote);
  const combinedTotal = exactSum([...observedQuote, ...estimatedQuote]);
  const observed = observedTotal === undefined
    ? null
    : projectedMoneyFromDecimal(profile, observedTotal, mode, contributingSlots.length);
  const estimated = estimatedTotal === undefined
    ? null
    : projectedMoneyFromDecimal(profile, estimatedTotal, mode, contributingSlots.length);
  const combined = combinedTotal === undefined
    ? null
    : projectedMoneyFromDecimal(profile, combinedTotal, mode, contributingSlots.length);
  const basis = costBasis(observed, estimated);
  const complete = slots.length > 0 && slots.every((slot) => slot.complete && slotHasQuoteAmount(slot, profile.currency));
  const common = Object.freeze({
    profile: closeCostProjectionProfile(profile),
    aggregate: combinedTotal === undefined
      ? mode === "mean"
        ? Object.freeze({ kind: "mean" as const, numerator: "0" as CanonicalDecimal, denominator: 0 })
        : Object.freeze({ kind: "total" as const, total: "0" as CanonicalDecimal })
      : mode === "mean"
      ? Object.freeze({
        kind: "mean" as const,
        numerator: normalizeCanonicalDecimal(combinedTotal),
        denominator: contributingSlots.length,
      })
      : Object.freeze({ kind: "total" as const, total: normalizeCanonicalDecimal(combinedTotal) }),
    observedOtherCurrencies: Object.freeze(
      slots.flatMap((slot) => slot.observed)
        .filter((entry) => entry.currency !== profile.currency)
        .sort(compareObserved),
    ),
    reasons: freezeReasons(slots.flatMap((slot) => slot.reasons)),
    ledger: Object.freeze(slots.flatMap((slot) => slot.ledger).sort(compareLedger)),
  });
  const migrationRequired = combined === null && slots.length > 0 && slots.every((slot) =>
    slot.reasons.some((reason) => reason.code === "usage-migration-required")
  );
  const projection: CostProjectionValue = combined === null
    ? Object.freeze({
      state: migrationRequired ? "migration-required" as const : "unavailable" as const,
      basis: "unavailable" as const,
      observed: null,
      estimated: null,
      combined: null,
      ...common,
    })
    : Object.freeze({
      state: complete ? "available" as const : "partial" as const,
      basis,
      observed,
      estimated,
      combined,
      ...common,
    });
  const numeric = combined === null ? null : Number(combined.amount);
  return Object.freeze({
    projection,
    samples: contributingSlots.length,
    total: slots.length,
    refs: freezeRefs(slots.flatMap((slot) => slot.refs)),
    value: numeric !== null && Number.isFinite(numeric) ? numeric : null,
  });
}

function matchingCoverage(
  profile: PricingProfile,
  provider: SafeIdentifier,
  core: ClosedAttemptCore,
): PricingCoverage | undefined {
  const matches = profile.coverage.filter((coverage) => pricingCoverageMatches(coverage, {
    provider,
    origin: core.origin,
  }));
  if (matches.length > 1) {
    throw new Error("PricingProfile validation allowed multiple matching coverage entries");
  }
  if (matches[0] !== undefined) return matches[0];
  const model = core.origin.execution.model;
  return profile.contentIdentity === builtInPricingProfile.contentIdentity && model !== null
    ? builtInPricingCoverage(model)
    : undefined;
}

function estimateProvider(
  slot: AnalysisSlotRef,
  provider: SafeIdentifier,
  observations: UsageSnapshot["observations"],
  coverage: Extract<PricingCoverage, { readonly state: "priced" }>,
  reasons: CostCoverageReason[],
): {
  readonly amount: CanonicalDecimal;
  readonly complete: boolean;
  readonly components: readonly (EstimatedTokenCostComponent | EstimatedRequestCostComponent)[];
} {
  const charges = new Map<string, PricingCharge>();
  for (const charge of coverage.charges) {
    charges.set(charge.kind === "token" ? `token:${charge.bucket}` : `request:${charge.requestKind}`, charge);
  }
  const amounts: CanonicalDecimal[] = [];
  const components: (EstimatedTokenCostComponent | EstimatedRequestCostComponent)[] = [];
  let complete = true;
  const hasReasoning = observations.some((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "reasoning"
  );
  const hasOutput = observations.some((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "output"
  );
  // Reasoning is a detail inside the provider's output total, not an
  // independently billable bucket. If only that detail was recorded, the
  // output subtotal is unknown; silently dropping it would understate cost.
  if (hasReasoning && !hasOutput) {
    complete = false;
    reasons.push(costReason(slot, provider, "pricing-charge-not-found"));
  }
  for (const observation of observations) {
    if (observation.kind === "provider-cost") continue;
    if (observation.kind === "token-bucket") {
      // reasoning is an output subset and cannot be independently priced.
      if (observation.bucket === "reasoning") continue;
      // `other` has no v1 independent-price coordinate and is not covered by
      // any of the billable token buckets. It therefore makes this provider
      // closure incomplete even when input/output were priced successfully.
      if (observation.bucket === "other") {
        complete = false;
        reasons.push(costReason(slot, provider, "pricing-charge-not-found"));
        continue;
      }
      const charge = charges.get(`token:${observation.bucket}`);
      if (charge === undefined || charge.kind !== "token") {
        complete = false;
        reasons.push(costReason(slot, provider, "pricing-charge-not-found"));
      } else {
        const tokens = requiredNonNegativeSafeInteger(observation.tokens, "Usage token count");
        const amount = costForPerMillionTokens(charge.perMillionTokens, tokens);
        amounts.push(amount);
        components.push(Object.freeze({
          kind: "token" as const,
          provider,
          bucket: charge.bucket,
          tokens,
          ratePerMillionTokens: charge.perMillionTokens,
          amount,
        }));
      }
      continue;
    }
    if (observation.kind === "request") {
      const charge = charges.get(`request:${observation.requestKind}`);
      if (charge === undefined || charge.kind !== "request") {
        complete = false;
        reasons.push(costReason(slot, provider, "pricing-charge-not-found"));
      } else {
        const amount = multiplyCanonicalDecimalByInteger(
          charge.ratePerRequest,
          1 as NonNegativeSafeInteger,
        );
        amounts.push(amount);
        components.push(Object.freeze({
          kind: "request" as const,
          provider,
          requestKind: charge.requestKind,
          ratePerRequest: charge.ratePerRequest,
          amount,
        }));
      }
    }
  }
  return Object.freeze({
    amount: exactCanonicalSum(amounts),
    complete,
    components: Object.freeze([...components].sort(compareComponent)),
  });
}

function exactSum(values: readonly CanonicalDecimal[]): DecimalCoefficient | undefined {
  return values.length === 0 ? undefined : addDecimalCoefficients(values.map(parseCanonicalDecimal));
}

function exactCanonicalSum(values: readonly CanonicalDecimal[]): CanonicalDecimal {
  return normalizeCanonicalDecimal(addDecimalCoefficients(values.map(parseCanonicalDecimal)));
}

function projectedMoneyFromDecimal(
  profile: PricingProfile,
  value: DecimalCoefficient,
  mode?: "mean" | "total",
  contributingSlots?: number,
): ProjectedMoney {
  if (mode === "mean" && (contributingSlots === undefined || contributingSlots <= 0)) {
    throw new Error("Cost mean cannot round without a quote-currency denominator");
  }
  const rational = mode === "mean"
    ? divideDecimalCoefficient(value, contributingSlots!)
    : rationalFromDecimal(value);
  return Object.freeze({
    amount: roundDecimalRationalHalfAway(rational, profile.display.decimalPlaces),
    currency: profile.currency as CurrencyCode,
    decimalPlaces: profile.display.decimalPlaces,
  });
}

function slotHasQuoteAmount(slot: CostSlotProjection, currency: string): boolean {
  return slot.ledger.some((entry) =>
    entry.branch === "estimated" ||
    (entry.branch === "observed" && entry.components.every((component) => component.currency === currency))
  );
}

function costBasis(observed: ProjectedMoney | null, estimated: ProjectedMoney | null): Exclude<CostBasis, "unavailable"> {
  if (observed !== null && estimated !== null) return "mixed";
  return observed !== null ? "observed" : "estimated";
}

function closeSlot(member: LogicalSlot): AnalysisSlotRef {
  return Object.freeze({
    runId: member.runId,
    slotId: member.slotId,
    experimentId: member.experimentId,
    evalId: member.evalId,
    attemptOrdinal: member.attemptOrdinal,
    executionIdentityDigest: member.executionIdentityDigest,
  });
}

function costReason(
  slot: AnalysisSlotRef,
  provider: SafeIdentifier | null,
  code: CostCoverageReason["code"],
): CostCoverageReason {
  return Object.freeze({ slot, provider, code });
}

function unavailableLedger(slot: AnalysisSlotRef, provider: SafeIdentifier | null): CostLedgerEntry {
  return Object.freeze({
    slot,
    provider,
    branch: "unavailable" as const,
    components: Object.freeze([]) as readonly [],
    estimated: null,
  });
}

function freezeReasons(values: readonly CostCoverageReason[]): readonly CostCoverageReason[] {
  const byIdentity = new Map<string, CostCoverageReason>();
  for (const value of values) {
    const key = `${slotIdentity(value.slot)}\u0000${value.provider ?? ""}\u0000${value.code}`;
    if (!byIdentity.has(key)) byIdentity.set(key, value);
  }
  return Object.freeze([...byIdentity.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([, value]) => value));
}

function freezeRefs(values: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const byIdentity = new Map<string, EvidenceRef>();
  for (const value of values) {
    const key = `${value.identity.kind}\u0000${value.identity.locator}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, Object.freeze({ identity: Object.freeze({ ...value.identity }) }));
    }
  }
  return Object.freeze([...byIdentity.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([, value]) => value));
}

function compareProviderEntry(
  [left]: readonly [SafeIdentifier, UsageSnapshot["observations"][number][]],
  [right]: readonly [SafeIdentifier, UsageSnapshot["observations"][number][]],
): number {
  return compareUtf8(left, right);
}

function compareObserved(left: ObservedOtherCurrency, right: ObservedOtherCurrency): number {
  const leftKey = `${left.provider}\u0000${left.currency}\u0000${left.amount}`;
  const rightKey = `${right.provider}\u0000${right.currency}\u0000${right.amount}`;
  return compareUtf8(leftKey, rightKey);
}

function compareLedger(left: CostLedgerEntry, right: CostLedgerEntry): number {
  const leftKey = `${slotIdentity(left.slot)}\u0000${left.provider ?? ""}\u0000${left.branch}`;
  const rightKey = `${slotIdentity(right.slot)}\u0000${right.provider ?? ""}\u0000${right.branch}`;
  return compareUtf8(leftKey, rightKey);
}

function slotIdentity(slot: AnalysisSlotRef): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}

function compareComponent(left: CostComponent, right: CostComponent): number {
  const leftKey = componentKey(left);
  const rightKey = componentKey(right);
  return compareUtf8(leftKey, rightKey);
}

function componentKey(value: CostComponent): string {
  switch (value.kind) {
    case "provider-cost":
      return `provider-cost\u0000${value.provider}\u0000${value.currency}\u0000${value.amount}`;
    case "token":
      return `token\u0000${value.provider}\u0000${value.bucket}\u0000${value.tokens}\u0000${value.amount}`;
    case "request":
      return `request\u0000${value.provider}\u0000${value.requestKind}\u0000${value.amount}`;
  }
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const first = new TextEncoder().encode(left);
  const second = new TextEncoder().encode(right);
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

function requiredSafeIdentifier(value: string, name: string): SafeIdentifier {
  const identifier = makeSafeIdentifier(value);
  if (identifier === undefined) throw new Error(`${name} is not a SafeIdentifier`);
  return identifier;
}

function requiredCurrencyCode(value: string, name: string): CurrencyCode {
  const currency = makeCurrencyCode(value);
  if (currency === undefined) throw new Error(`${name} is not a CurrencyCode`);
  return currency;
}

function requiredCanonicalDecimal(value: string, name: string): CanonicalDecimal {
  const decimal = makeCanonicalDecimal(value);
  if (decimal === undefined) throw new Error(`${name} is not a canonical decimal`);
  return decimal;
}

function requiredNonNegativeSafeInteger(value: number, name: string): NonNegativeSafeInteger {
  const integer = makeNonNegativeSafeInteger(value);
  if (integer === undefined) throw new Error(`${name} is not a non-negative safe integer`);
  return integer;
}
