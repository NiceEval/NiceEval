import type { JudgePriceReceipt, JudgeUsageAttachment, JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import {
  addCanonicalDecimals,
  canonicalDecimalFromNumber,
  multiplyCanonicalDecimalPerMillion,
} from "../record/family/adapter-usage/pricing.ts";
import { compareCanonicalDecimal, effectiveCostTotals, type EffectiveCallCost } from "./adapter-usage-projection.ts";
import type {
  EstimatedCostRange,
  InspectionAttemptUsageResult,
  JudgeUsage,
  JudgeUsageSummary,
  TotalUsageCosts,
} from "../inspection/results.ts";
import { callPage } from "../inspection/collection-page.ts";
import { INSPECTION_USAGE_CALL_PAGE_BYTES, INSPECTION_USAGE_CALL_PAGE_SIZE } from "../inspection/limits.ts";
import { combineCostGaps, type RecordedTotalUsageCosts } from "./cost-gaps.ts";

import { compareJudgeUsageCalls } from "./usage-contract.ts";

function judgeCallEstimatedRange(
  call: JudgeUsageCall,
  receipt: JudgePriceReceipt | undefined,
): EstimatedCostRange | undefined {
  if (
    receipt?.state !== "partial" ||
    call.inputTotalTokens === null ||
    !receipt.missing.some(({ bucket, reason }) => bucket !== "output" && reason === "tokens-unknown")
  )
    return undefined;
  const output = receipt.charges.find(({ bucket }) => bucket === "output");
  const { input, cacheRead, cacheWrite } = receipt.pricing.ratesPerMTok;
  if (output === undefined || input === null || cacheRead === null || cacheWrite === null) return undefined;
  if (compareCanonicalDecimal(cacheRead, input) > 0 || compareCanonicalDecimal(cacheRead, cacheWrite) > 0) {
    return undefined;
  }
  const highRate = compareCanonicalDecimal(input, cacheWrite) >= 0 ? input : cacheWrite;
  return {
    currency: receipt.currency,
    lower: addCanonicalDecimals([output.amount, multiplyCanonicalDecimalPerMillion(cacheRead, call.inputTotalTokens)]),
    upper: addCanonicalDecimals([output.amount, multiplyCanonicalDecimalPerMillion(highRate, call.inputTotalTokens)]),
  };
}

function sumEstimatedCostRange(
  costs: readonly { amount?: string | undefined; estimatedRange?: EstimatedCostRange | undefined }[],
): EstimatedCostRange | undefined {
  if (!costs.some(({ estimatedRange }) => estimatedRange !== undefined)) return undefined;
  let lower = "0";
  let upper = "0";
  for (const { amount, estimatedRange } of costs) {
    lower = addCanonicalDecimals([lower, estimatedRange?.lower ?? amount ?? "0"]);
    upper = addCanonicalDecimals([upper, estimatedRange?.upper ?? amount ?? "0"]);
  }
  return { currency: "USD", lower, upper };
}

/** The ledger is already validated; independent metrics retain their own coverage. */
export function projectJudgeUsage(ledger: JudgeUsageAttachment, page = 0): JudgeUsage {
  const receipts = new Map(ledger.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  const builtinCatalogCalls = ledger.priceReceipts.filter(
    ({ pricing }) => pricing.source.kind === "builtin-catalog",
  ).length;
  const costCalls = ledger.calls.map((call) => {
    const receipt = receipts.get(call.callId);
    const estimatedRange = judgeCallEstimatedRange(call, receipt);
    function effectiveCost(): EffectiveCallCost | undefined {
      if (call.cost !== null) return { ...call.cost, state: "complete" };
      if (receipt === undefined) return undefined;
      return { amount: receipt.amount, currency: receipt.currency, source: receipt.source, state: receipt.state };
    }
    return {
      call: estimatedRange === undefined ? call : { ...call, estimatedRange },
      effectiveCost: effectiveCost(),
      estimatedRange,
    };
  });
  const costs = effectiveCostTotals(costCalls, ledger.collection.state);
  const estimatedRange = sumEstimatedCostRange(
    costCalls.map(({ effectiveCost, estimatedRange }) => ({
      amount: effectiveCost?.currency === "USD" ? effectiveCost.amount : undefined,
      estimatedRange,
    })),
  );
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
  return {
    state: ledger.collection.state,
    coverage: "physical-transmissions",
    ...(builtinCatalogCalls === 0 ? {} : { builtinCatalogCalls }),
    collection: ledger.collection,
    ...callPage(
      costCalls.map(({ call }) => call).sort(compareJudgeUsageCalls),
      ledger.priceReceipts,
      page,
      INSPECTION_USAGE_CALL_PAGE_SIZE,
      INSPECTION_USAGE_CALL_PAGE_BYTES,
    ),
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
      ...(estimatedRange === undefined ? {} : { estimatedRange }),
    },
  };
}

export function summarizeJudgeUsage(usage: JudgeUsage): JudgeUsageSummary {
  if (usage.state === "unavailable" || usage.state === "invalid") return usage;
  return {
    state: usage.state,
    coverage: usage.coverage,
    ...(usage.builtinCatalogCalls === undefined ? {} : { builtinCatalogCalls: usage.builtinCatalogCalls }),
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
  recordedGaps: RecordedTotalUsageCosts["gaps"] = [],
): RecordedTotalUsageCosts {
  const applicationValues =
    application.costs !== undefined
      ? application.costs.values
      : (application.providerCosts?.values ?? []).map(({ currency, value }) => ({
          currency,
          value,
          source: "reported" as const,
        }));
  const judgeTotals = judge.state === "complete" || judge.state === "partial" ? judge.totals : undefined;
  const judgeCosts = judgeTotals?.costs;
  const completeApplication =
    applicationCollectionProven &&
    (applicationEmptyComplete ||
      application.costs?.state === "complete" ||
      (application.costs === undefined && application.providerCosts?.state === "available"));
  const missingSources: ("application" | "judge" | "simulated-user")[] = [];
  if (!completeApplication) missingSources.push("application");
  if (judgeCosts?.state !== "complete") missingSources.push("judge");
  if (simulatedUser !== undefined && simulatedUser.state !== "complete") missingSources.push("simulated-user");
  const nonJudgeValues = [
    ...applicationValues,
    ...(simulatedUser?.amountUSD == null
      ? []
      : [
          {
            currency: "USD",
            value: canonicalDecimalFromNumber(simulatedUser.amountUSD)!,
            source: simulatedUser.costBasis ?? "estimated",
          },
        ]),
  ];
  const values = sumCostValues([...nonJudgeValues, ...(judgeCosts?.values ?? [])]);
  const estimatedRange = sumEstimatedCostRange([
    { estimatedRange: judgeTotals?.estimatedRange },
    ...nonJudgeValues.filter(({ currency }) => currency === "USD").map(({ value }) => ({ amount: value })),
  ]);
  return {
    state: totalCostState(missingSources.length, values.length),
    values,
    ...(estimatedRange === undefined ? {} : { estimatedRange }),
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
    ...(simulatedUser === undefined ? {} : { simulatedUser }),
  };
}

/** Inputs are unique origin Attempts, never preview rows or verdict-filtered members. */
export function combineTotalUsageCosts(
  totals: readonly RecordedTotalUsageCosts[],
  unresolved = false,
): RecordedTotalUsageCosts {
  const missingSources = (["application", "judge", "simulated-user"] as const).filter(
    (source) =>
      (unresolved && source !== "simulated-user") || totals.some((total) => total.missingSources.includes(source)),
  );
  const values = sumCostValues(totals.flatMap((total) => total.values));
  const estimatedRange = sumEstimatedCostRange(
    totals.map((total) => ({
      amount: total.values.find(({ currency }) => currency === "USD")?.value,
      estimatedRange: total.estimatedRange,
    })),
  );
  const sources = totals.flatMap((total) => (total.simulatedUser === undefined ? [] : [total.simulatedUser]));
  const amounts = sources.flatMap((source) => (source.amountUSD === null ? [] : [source.amountUSD]));
  const builtinCatalogCalls = sources.reduce((sum, source) => sum + (source.builtinCatalogCalls ?? 0), 0);
  const costSources = sources.flatMap(({ amountUSD, costBasis }) =>
    amountUSD === null ? [] : [costBasis ?? "estimated"],
  );
  const reported = costSources.some((source) => source !== "estimated");
  const estimated = costSources.some((source) => source !== "reported");
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
          ...(reported ? { costBasis: estimated ? "mixed" : "reported" } : {}),
          ...(builtinCatalogCalls === 0 ? {} : { builtinCatalogCalls }),
        };
  return {
    state: totalCostState(missingSources.length, values.length),
    values,
    ...(estimatedRange === undefined ? {} : { estimatedRange }),
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
    ...(simulatedUser === undefined ? {} : { simulatedUser }),
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
