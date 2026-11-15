import { projectCacheRead, type CacheReadReport } from "./cache-read.ts";
import type { ResolvedModelRoles } from "../model-roles.ts";
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

/** Frozen cache report with author-facing selection by Experiment model purpose. */
export interface EvalCacheRead<ModelRole extends string = string> extends CacheReadReport {
  /** Omit the role for the total. An undeclared role throws; missing observations remain unavailable. */
  rate(role?: ModelRole): NumericMaterial<"ratio">;
}

function authorCacheRead(report: CacheReadReport, models?: ResolvedModelRoles): EvalCacheRead {
  const declared = new Set(Object.keys(models ?? {}));
  const rates = new Map(report.roles.map((group) => [group.modelRole, group.rate]));
  return {
    ...report,
    rate: (role?: string): NumericMaterial<"ratio"> => {
      if (role === undefined)
        return Object.freeze({
          ...report.total.rate,
          unit: "ratio",
          provenance: undefined,
        });
      if (!declared.has(role)) {
        throw new TypeError(
          `Undeclared model role ${JSON.stringify(role)}; declared roles: ${[...declared].join(", ") || "(none)"}.`,
        );
      }
      const rate = rates.get(role);
      if (rate !== undefined && !(rate.state === "unavailable" && rate.reason === "no-calls"))
        return Object.freeze({
          ...rate,
          unit: "ratio",
          provenance: undefined,
        });
      return Object.freeze({
        state: "unavailable",
        reason: "role-has-no-calls",
        unit: "ratio",
        provenance: undefined,
      });
    },
  };
}

/** Internal source-owned shape; package-root exposure belongs to the author facade. */
export interface EvalUsage<ModelRole extends string = string> {
  readonly source: "agent" | "adapter" | "unavailable";
  readonly scope: "turn" | "session" | "attempt";
  readonly basis: "reported-sends" | "recorded-calls" | "unbound";
  readonly cut: "call-time";
  readonly cacheRead: EvalCacheRead<ModelRole>;
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

interface AgentUsageContributionIdentity {
  readonly sessionScopeId: string;
  readonly turnId: string;
  readonly sendAttempt: number;
  readonly model: string | undefined;
  readonly coverage: ResolvedEvidenceCoverage["usage"];
}

export type AgentUsageContribution = AgentUsageContributionIdentity &
  (
    | { readonly state: "pending" }
    | {
        readonly state: "terminal";
        readonly outcome: "completed" | "failed" | "interrupted";
        readonly usage: Readonly<Usage> | undefined;
      }
  );

type TokenMetric =
  | "inputTokens"
  | "inputTotalTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "totalTokens";

function contributionCosts(
  calls: readonly { readonly effectiveCost: EffectiveCallCost | undefined }[],
  complete: boolean,
): EvalUsage["costs"] {
  const totals = effectiveCostTotals(calls, complete ? "complete" : "partial");
  return {
    state: totals.state,
    values: totals.values.map((value) => ({
      currency: value.currency,
      value: value.value,
      source: value.source,
      coveredContributions: value.coveredCalls,
      reportedContributions: value.reportedCalls,
      estimatedContributions: value.estimatedCalls,
    })),
    totalContributions: totals.totalCalls,
  };
}

function freezeUsageSnapshot<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeUsageSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export function projectAdapterEvalUsage(usage: ReadableAdapterUsageAttachment, models?: ResolvedModelRoles): EvalUsage {
  return freezeUsageSnapshot({
    source: "adapter",
    scope: "attempt",
    basis: "recorded-calls",
    cut: "call-time",
    cacheRead: authorCacheRead(
      projectCacheRead(usage, models === undefined ? undefined : Object.keys(models), true),
      models,
    ),
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
  if (contribution.state === "pending" || contribution.usage === undefined) return [undefined];
  const usage: Readonly<Usage> & { readonly inputTotalTokens?: number } = contribution.usage;
  const input =
    usage.inputTotalTokens !== undefined
      ? [usage.inputTotalTokens]
      : [usage.inputTokens, usage.cacheReadTokens, usage.cacheCreationTokens];
  switch (metric) {
    case "inputTotalTokens":
      return input;
    case "totalTokens":
      return [...input, usage.outputTokens];
    case "cacheWriteTokens":
      return [usage.cacheCreationTokens];
    default:
      return [usage[metric]];
  }
}

function agentTokenMaterial(
  contributions: readonly AgentUsageContribution[],
  metric: TokenMetric,
  scope: EvalUsage["scope"],
): NumericMaterial {
  const provenance = { source: "agent", scope, unit: "tokens", cut: "call-time" };
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
        return {
          state: "unavailable",
          reason: "usage-invalid-token-value",
          provenance,
          unit: undefined,
        };
      }
      value += bucket;
      observed = true;
      if (!Number.isSafeInteger(value)) {
        return {
          state: "unavailable",
          reason: "usage-exceeds-safe-integer",
          provenance,
          unit: undefined,
        };
      }
    }
  }
  if (!observed)
    return {
      state: "unavailable",
      reason: "usage-not-reported",
      provenance,
      unit: undefined,
    };
  return {
    state: complete ? "exact" : "lower-bound",
    value,
    provenance,
    unit: undefined,
  };
}

function agentCost(
  contribution: AgentUsageContribution,
  pricing: Record<string, PriceOverride> | undefined,
): EffectiveCallCost | undefined {
  if (contribution.state === "pending" || contribution.usage === undefined) return undefined;
  const usage = contribution.usage;
  const coverageComplete = contribution.coverage.status === "complete";
  if (usage.costUSD !== undefined) {
    const amount = canonicalDecimalFromNumber(usage.costUSD);
    return amount === undefined
      ? undefined
      : {
          amount,
          currency: "USD",
          source: { kind: "reported", id: "agent-send" },
          state: coverageComplete ? "complete" : "partial",
        };
  }
  const model = contribution.model;
  if (model === undefined || pricing === undefined) return undefined;
  const wildcard = model.includes("/") ? `${model.slice(0, model.indexOf("/"))}/*` : undefined;
  const configuredPrice = () => {
    if (Object.hasOwn(pricing, model)) return pricing[model];
    if (wildcard !== undefined && Object.hasOwn(pricing, wildcard)) return pricing[wildcard];
    return undefined;
  };
  const profile = configuredPrice();
  if (
    profile === undefined ||
    (profile.currency !== undefined && profile.currency !== "USD") ||
    (profile.basis !== undefined && profile.basis !== "catalog-reference")
  )
    return undefined;
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
  return charges.length === 0
    ? undefined
    : {
        amount: addCanonicalDecimals(charges),
        currency: "USD",
        source: { kind: "estimated", id: profile.source?.id ?? "niceeval.config.pricing" },
        state: complete ? "complete" : "partial",
      };
}

/** The receiver selects scope membership before calling this pure projection. */
export function projectAgentEvalUsage(input: {
  contributions: readonly AgentUsageContribution[];
  scope: "turn" | "session" | "attempt";
  pricing: Record<string, PriceOverride> | undefined;
}): EvalUsage {
  return freezeUsageSnapshot({
    source: "agent",
    scope: input.scope,
    basis: "reported-sends",
    cut: "call-time",
    cacheRead: authorCacheRead(projectCacheRead(undefined, undefined, false, "adapter-usage-required")),
    inputTokens: agentTokenMaterial(input.contributions, "inputTokens", input.scope),
    inputTotalTokens: agentTokenMaterial(input.contributions, "inputTotalTokens", input.scope),
    outputTokens: agentTokenMaterial(input.contributions, "outputTokens", input.scope),
    cacheReadTokens: agentTokenMaterial(input.contributions, "cacheReadTokens", input.scope),
    cacheWriteTokens: agentTokenMaterial(input.contributions, "cacheWriteTokens", input.scope),
    totalTokens: agentTokenMaterial(input.contributions, "totalTokens", input.scope),
    costs: contributionCosts(
      input.contributions.map((contribution) => ({
        effectiveCost: agentCost(contribution, input.pricing),
      })),
      input.contributions.every(
        (contribution) => contribution.state === "terminal" && contribution.coverage.status === "complete",
      ),
    ),
  });
}
