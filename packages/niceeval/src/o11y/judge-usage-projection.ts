import type { JudgeUsageAttachment } from "../record/family/judge-usage/schema.ts";
import { addCanonicalDecimals, canonicalDecimalFromNumber } from "../record/family/adapter-usage/pricing.ts";
import { effectiveCostTotals, type EffectiveCallCost } from "./adapter-usage-projection.ts";
import type {
  CostGap,
  InspectionAttemptUsageResult,
  JudgeUsage,
  JudgeUsageSummary,
  TotalUsageCosts,
} from "../inspection/results.ts";
import { utf8ByteLength } from "../inspection/bytes.ts";
import { combineCostGaps } from "./cost-gaps.ts";

import {
  compareJudgeUsageCalls,
  JUDGE_USAGE_PREVIEW_BYTE_LIMIT,
  JUDGE_USAGE_PREVIEW_CALL_LIMIT,
} from "./usage-contract.ts";

/** The ledger is already validated; independent metrics retain their own coverage. */
export function projectJudgeUsage(ledger: JudgeUsageAttachment): JudgeUsage {
  const receipts = new Map(ledger.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  const costCalls = ledger.calls.map((call): { readonly effectiveCost: EffectiveCallCost | undefined } => {
    const receipt = receipts.get(call.callId);
    function effectiveCost(): EffectiveCallCost | undefined {
      if (call.cost !== null) return { ...call.cost, state: "complete" };
      if (receipt === undefined) return undefined;
      return { amount: receipt.amount, currency: receipt.currency, source: receipt.source, state: receipt.state };
    }
    return {
      effectiveCost: effectiveCost(),
    };
  });
  const costs = effectiveCostTotals(costCalls, ledger.collection.state);
  const numeric = (metric: "inputTotalTokens" | "outputTokens" | "totalTokens") => {
    let value = 0;
    let observationCount = 0;
    let complete = ledger.collection.state === "complete";
    for (const call of ledger.calls) {
      const inputBuckets = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens];
      const knownInputs = inputBuckets.filter((bucket): bucket is number => bucket !== null);
      const input =
        call.inputTotalTokens ??
        (knownInputs.length === 0 ? null : knownInputs.reduce((sum, bucket) => sum + bucket, 0));
      function tokenBuckets() {
        if (metric === "inputTotalTokens") return [input];
        if (metric === "outputTokens") return [call.outputTokens];
        return [input, call.outputTokens];
      }
      const buckets = tokenBuckets();
      if (buckets.some((bucket) => bucket !== null)) observationCount++;
      for (const bucket of buckets) {
        if (bucket === null) complete = false;
        else value += bucket;
      }
      if (metric !== "outputTokens" && call.inputTotalTokens === null && knownInputs.length !== 3) complete = false;
    }
    if (
      !Number.isSafeInteger(value) ||
      (observationCount === 0 && ledger.calls.length > 0) ||
      (ledger.calls.length === 0 && !complete)
    ) {
      return { state: "unavailable" as const, value: null, observationCount };
    }
    return { state: complete ? ("available" as const) : ("partial" as const), value, observationCount };
  };
  const all: Extract<JudgeUsage, { readonly state: "complete" | "partial" }> = {
    state: ledger.collection.state,
    coverage: "physical-transmissions",
    collection: ledger.collection,
    calls: [...ledger.calls].sort(compareJudgeUsageCalls),
    callsTruncated: false,
    omittedCallCount: 0,
    totals: {
      requests: {
        state: ledger.collection.state === "complete" ? "available" : "partial",
        value: ledger.calls.length,
        observationCount: ledger.calls.length,
      },
      inputTotalTokens: numeric("inputTotalTokens"),
      outputTokens: numeric("outputTokens"),
      totalTokens: numeric("totalTokens"),
      costs:
        ledger.collection.state === "complete" && ledger.calls.length === 0 ? { ...costs, state: "complete" } : costs,
    },
    priceReceipts: ledger.priceReceipts,
  };
  let preview = takeJudgeUsagePreview(all, JUDGE_USAGE_PREVIEW_CALL_LIMIT);
  while (
    utf8ByteLength(JSON.stringify({ calls: preview.calls, priceReceipts: preview.priceReceipts })) >
      JUDGE_USAGE_PREVIEW_BYTE_LIMIT &&
    preview.calls.length > 0
  ) {
    preview = takeJudgeUsagePreview(preview, preview.calls.length - 1);
  }
  return preview;
}

/** Shrinking details never changes totals and retains only the corresponding price proofs. */
export function takeJudgeUsagePreview(
  usage: Extract<JudgeUsage, { readonly state: "complete" | "partial" }>,
  maximumCalls: number,
): Extract<JudgeUsage, { readonly state: "complete" | "partial" }> {
  const calls = usage.calls.slice(0, maximumCalls);
  const receipts = new Map(usage.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  const priceReceipts = calls.flatMap((call) => {
    const receipt = receipts.get(call.callId);
    return receipt === undefined ? [] : [receipt];
  });
  const omittedCallCount = usage.omittedCallCount + usage.calls.length - calls.length;
  return { ...usage, calls, priceReceipts, callsTruncated: omittedCallCount > 0, omittedCallCount };
}

export function summarizeJudgeUsage(usage: JudgeUsage): JudgeUsageSummary {
  if (usage.state === "unavailable" || usage.state === "invalid") return usage;
  return {
    state: usage.state,
    coverage: usage.coverage,
    collection: usage.collection,
    totals: usage.totals,
  };
}

/** Currency-preserving known subtotals; no exchange rate or fabricated zero currency. */
export function projectTotalUsageCosts(
  application: InspectionAttemptUsageResult["totals"],
  judge: JudgeUsageSummary,
  applicationEmptyComplete = false,
  applicationCollectionProven = true,
  simulatedUser?: TotalUsageCosts["simulatedUser"],
  recordedGaps: readonly CostGap[] = [],
): TotalUsageCosts {
  const applicationValues =
    application.costs !== undefined
      ? application.costs.values
      : (application.providerCosts?.values ?? []).map(({ currency, value }) => ({
          currency,
          value,
          source: "reported" as const,
        }));
  const judgeCosts = judge.state === "complete" || judge.state === "partial" ? judge.totals.costs : undefined;
  const completeApplication =
    applicationCollectionProven &&
    (applicationEmptyComplete ||
      application.costs?.state === "complete" ||
      (application.costs === undefined && application.providerCosts?.state === "available"));
  const missingSources: ("application" | "judge" | "simulated-user")[] = [];
  if (!completeApplication) missingSources.push("application");
  if (judgeCosts?.state !== "complete") missingSources.push("judge");
  if (simulatedUser !== undefined && simulatedUser.state !== "complete") missingSources.push("simulated-user");
  const values = sumCostValues([
    ...applicationValues,
    ...(judgeCosts?.values ?? []),
    ...(simulatedUser?.amountUSD == null
      ? []
      : [
          {
            currency: "USD",
            value: canonicalDecimalFromNumber(simulatedUser.amountUSD)!,
            source: "estimated" as const,
          },
        ]),
  ]);
  return {
    state: totalCostState(missingSources.length, values.length),
    values,
    missingSources: missingSources,
    gaps: combineCostGaps(
      missingSources.flatMap((source) => {
        const gaps = recordedGaps.filter((gap) => gap.source === source);
        return gaps.length > 0
          ? gaps
          : [
              {
                source,
                reason:
                  source === "simulated-user"
                    ? ("provider-cost-not-reported" as const)
                    : ("usage-not-recorded" as const),
                models: [],
              },
            ];
      }),
    ),
    simulatedUser,
  };
}

/** Inputs are unique origin Attempts, never preview rows or verdict-filtered members. */
export function combineTotalUsageCosts(totals: readonly TotalUsageCosts[], unresolved = false): TotalUsageCosts {
  const missingSources = (["application", "judge", "simulated-user"] as const).filter(
    (source) =>
      (unresolved && source !== "simulated-user") || totals.some((total) => total.missingSources.includes(source)),
  );
  const values = sumCostValues(totals.flatMap((total) => total.values));
  const sources = totals.flatMap((total) => (total.simulatedUser === undefined ? [] : [total.simulatedUser]));
  const amounts = sources.flatMap((source) => (source.amountUSD === null ? [] : [source.amountUSD]));
  function simulatedUserState() {
    if (sources.every((source) => source.state === "complete")) return "complete" as const;
    return amounts.length > 0 ? ("partial" as const) : ("unpriced" as const);
  }
  const simulatedUser: TotalUsageCosts["simulatedUser"] =
    sources.length === 0
      ? undefined
      : {
          source: "simulated-user",
          state: simulatedUserState(),
          amountUSD: amounts.length === 0 ? null : amounts.reduce((sum, amount) => sum + amount, 0),
          calls: sources.reduce((sum, source) => sum + source.calls, 0),
        };
  return {
    state: totalCostState(missingSources.length, values.length),
    values,
    missingSources: missingSources,
    gaps: combineCostGaps([
      ...totals.flatMap((total) => total.gaps),
      ...(unresolved
        ? (["application", "judge"] as const).map((source) => ({
            source,
            reason: "usage-not-recorded" as const,
            models: [],
          }))
        : []),
    ]),
    simulatedUser,
  };
}

function totalCostState(missingSources: number, values: number): TotalUsageCosts["state"] {
  if (missingSources === 0) return "complete";
  return values === 0 ? "unavailable" : "partial";
}

function sumCostValues(entries: TotalUsageCosts["values"]): TotalUsageCosts["values"] {
  const grouped = new Map<string, { readonly value: string; readonly source: "reported" | "estimated" | "mixed" }[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.currency);
    if (group === undefined) grouped.set(entry.currency, [entry]);
    else group.push(entry);
  }
  return [...grouped.entries()]
    .sort(function compareCurrencies([left], [right]) {
      if (left < right) return -1;
      return left > right ? 1 : 0;
    })
    .map(([currency, entries]) => ({
      currency,
      value: addCanonicalDecimals(entries.map((entry) => entry.value)),
      source: entries.every((entry) => entry.source === entries[0]!.source) ? entries[0]!.source : ("mixed" as const),
    }));
}
