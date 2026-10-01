import type { NumericMaterial } from "../assertions/match.ts";
import type { ResolvedEvidenceCoverage } from "../assertions/coverage.ts";
import type { PriceOverride, Usage } from "../types.ts";
import type { ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import {
  addCanonicalDecimals,
  canonicalDecimalFromNumber,
  multiplyCanonicalDecimalPerMillion,
} from "../record/family/adapter-usage/pricing.ts";
import {
  adapterTokenMaterial,
  effectiveCostTotals,
  effectiveUsageCalls,
  type EffectiveCallCost,
} from "./adapter-usage-projection.ts";

/** Internal source-owned shape; package-root exposure belongs to the author facade. */
export interface EvalUsage {
  readonly source: "agent" | "adapter" | "unavailable";
  readonly scope: "turn" | "session" | "attempt";
  readonly basis: "reported-sends" | "recorded-calls" | "unbound";
  readonly cut: "call-time";
  readonly inputTokens: NumericMaterial;
  readonly inputTotalTokens: NumericMaterial;
  readonly outputTokens: NumericMaterial;
  readonly cacheReadTokens: NumericMaterial;
  readonly cacheWriteTokens: NumericMaterial;
  readonly totalTokens: NumericMaterial;
  readonly costs: {
    readonly state: "complete" | "partial" | "unavailable";
    readonly values: readonly {
      readonly currency: string;
      readonly value: string;
      readonly source: "reported" | "estimated" | "mixed";
      readonly coveredContributions: number;
      readonly reportedContributions: number;
      readonly estimatedContributions: number;
    }[];
    readonly totalContributions: number;
  };
}

export interface AgentUsageContribution {
  readonly sessionScopeId: string;
  readonly turnId: string;
  readonly sendAttempt: number;
  readonly state: "pending" | "terminal";
  readonly outcome: "completed" | "failed" | "interrupted" | null;
  readonly model: string | null;
  readonly usage: Readonly<Usage> | null;
  readonly coverage: ResolvedEvidenceCoverage["usage"];
}

type TokenMetric = "inputTokens" | "inputTotalTokens" | "outputTokens" |
  "cacheReadTokens" | "cacheWriteTokens" | "totalTokens";

function contributionCosts(
  calls: readonly { readonly effectiveCost: EffectiveCallCost | null }[],
  complete: boolean,
): EvalUsage["costs"] {
  const totals = effectiveCostTotals(calls, complete ? "complete" : "partial");
  return Object.freeze({
    state: totals.state,
    values: Object.freeze(totals.values.map((value) => Object.freeze({
      currency: value.currency,
      value: value.value,
      source: value.source,
      coveredContributions: value.coveredCalls,
      reportedContributions: value.reportedCalls,
      estimatedContributions: value.estimatedCalls,
    }))),
    totalContributions: totals.totalCalls,
  });
}

export function projectAdapterEvalUsage(usage: ReadableAdapterUsageAttachment): EvalUsage {
  return Object.freeze({
    source: "adapter",
    scope: "attempt",
    basis: "recorded-calls",
    cut: "call-time",
    inputTokens: adapterTokenMaterial(usage, "inputTokens"),
    inputTotalTokens: adapterTokenMaterial(usage, "inputTotalTokens"),
    outputTokens: adapterTokenMaterial(usage, "outputTokens"),
    cacheReadTokens: adapterTokenMaterial(usage, "cacheReadTokens"),
    cacheWriteTokens: adapterTokenMaterial(usage, "cacheWriteTokens"),
    totalTokens: adapterTokenMaterial(usage, "totalTokens"),
    costs: contributionCosts(effectiveUsageCalls(usage), usage.collection.state === "complete"),
  });
}

function tokenBuckets(contribution: AgentUsageContribution, metric: TokenMetric): readonly (number | undefined)[] {
  // Some producers have an independent total. Missing totals retain the mutually exclusive bucket fallback.
  const usage: (Readonly<Usage> & { readonly inputTotalTokens?: number }) | null = contribution.usage;
  if (contribution.state === "pending" || usage === null) return [undefined];
  const input = usage.inputTotalTokens !== undefined
    ? [usage.inputTotalTokens]
    : [usage.inputTokens, usage.cacheReadTokens, usage.cacheCreationTokens];
  switch (metric) {
    case "inputTotalTokens": return input;
    case "totalTokens": return [...input, usage.outputTokens];
    case "cacheWriteTokens": return [usage.cacheCreationTokens];
    default: return [usage[metric]];
  }
}

function agentTokenMaterial(
  contributions: readonly AgentUsageContribution[],
  metric: TokenMetric,
  scope: EvalUsage["scope"],
): NumericMaterial {
  const provenance = Object.freeze({ source: "agent", scope, unit: "tokens", cut: "call-time" });
  let value = 0;
  let observed = false;
  let complete = contributions.length > 0;
  for (const contribution of contributions) {
    if (contribution.state !== "terminal" || contribution.coverage.status !== "complete") complete = false;
    for (const bucket of tokenBuckets(contribution, metric)) {
      if (bucket === undefined) {
        complete = false;
        continue;
      }
      if (!Number.isSafeInteger(bucket) || bucket < 0) {
        return Object.freeze({ state: "unavailable", reason: "usage-invalid-token-value", provenance });
      }
      value += bucket;
      observed = true;
      if (!Number.isSafeInteger(value)) {
        return Object.freeze({ state: "unavailable", reason: "usage-exceeds-safe-integer", provenance });
      }
    }
  }
  return Object.freeze(!observed
    ? { state: "unavailable", reason: "usage-not-reported", provenance }
    : { state: complete ? "exact" : "lower-bound", value, provenance });
}

function agentCost(
  contribution: AgentUsageContribution,
  pricing: Record<string, PriceOverride> | undefined,
): EffectiveCallCost | null {
  const usage = contribution.usage;
  if (contribution.state === "pending" || usage === null) return null;
  const coverageComplete = contribution.coverage.status === "complete";
  if (usage.costUSD !== undefined) {
    const amount = canonicalDecimalFromNumber(usage.costUSD);
    return amount === undefined ? null : Object.freeze({
      amount, currency: "USD", source: Object.freeze({ kind: "reported", id: "agent-send" }),
      state: coverageComplete ? "complete" : "partial",
    });
  }
  const model = contribution.model;
  if (model === null || pricing === undefined) return null;
  const wildcard = model.includes("/") ? `${model.slice(0, model.indexOf("/"))}/*` : undefined;
  const profile = Object.hasOwn(pricing, model) ? pricing[model]
    : wildcard !== undefined && Object.hasOwn(pricing, wildcard) ? pricing[wildcard] : undefined;
  if (profile === undefined || profile.currency !== undefined && profile.currency !== "USD" ||
    profile.basis !== undefined && profile.basis !== "catalog-reference") return null;
  const buckets = [
    [usage.inputTokens, profile.inputPerMTok],
    [usage.outputTokens, profile.outputPerMTok],
    [usage.cacheReadTokens, profile.cacheReadPerMTok],
    [usage.cacheCreationTokens, profile.cacheWritePerMTok],
  ] as const;
  const charges: string[] = [];
  let complete = coverageComplete;
  for (const [tokens, price] of buckets) {
    if (tokens === undefined || !Number.isSafeInteger(tokens) || tokens < 0) {
      complete = false;
      continue;
    }
    if (tokens === 0) {
      charges.push("0");
      continue;
    }
    const rate = price === undefined ? undefined : canonicalDecimalFromNumber(price);
    if (rate === undefined) {
      complete = false;
      continue;
    }
    charges.push(multiplyCanonicalDecimalPerMillion(rate, tokens));
  }
  return charges.length === 0 ? null : Object.freeze({
    amount: addCanonicalDecimals(charges),
    currency: "USD",
    source: Object.freeze({ kind: "estimated", id: profile.source?.id ?? "niceeval.config.pricing" }),
    state: complete ? "complete" : "partial",
  });
}

/** The receiver selects scope membership before calling this pure projection. */
export function projectAgentEvalUsage(input: {
  contributions: readonly AgentUsageContribution[];
  scope: "turn" | "session" | "attempt";
  pricing?: Record<string, PriceOverride>;
}): EvalUsage {
  return Object.freeze({
    source: "agent",
    scope: input.scope,
    basis: "reported-sends",
    cut: "call-time",
    inputTokens: agentTokenMaterial(input.contributions, "inputTokens", input.scope),
    inputTotalTokens: agentTokenMaterial(input.contributions, "inputTotalTokens", input.scope),
    outputTokens: agentTokenMaterial(input.contributions, "outputTokens", input.scope),
    cacheReadTokens: agentTokenMaterial(input.contributions, "cacheReadTokens", input.scope),
    cacheWriteTokens: agentTokenMaterial(input.contributions, "cacheWriteTokens", input.scope),
    totalTokens: agentTokenMaterial(input.contributions, "totalTokens", input.scope),
    costs: contributionCosts(input.contributions.map((contribution) => ({
      effectiveCost: agentCost(contribution, input.pricing),
    })), input.contributions.every((contribution) => contribution.state === "terminal" && contribution.coverage.status === "complete")),
  });
}
