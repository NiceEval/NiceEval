import type { JudgeUsageAttachment, JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import { addCanonicalDecimals } from "../record/family/adapter-usage/pricing.ts";
import { effectiveCostTotals, type EffectiveCallCost } from "./adapter-usage-projection.ts";
import type {
  InspectionAttemptUsageResult, JudgeUsage, JudgeUsageSummary, TotalUsageCosts,
} from "../inspection/results.ts";
import { utf8ByteLength } from "../inspection/bytes.ts";

export const JUDGE_USAGE_PREVIEW_CALL_LIMIT = 128;
export const JUDGE_USAGE_PREVIEW_BYTE_LIMIT = 128 * 1024;

export function compareJudgeUsageCalls(left: JudgeUsageCall, right: JudgeUsageCall): number {
  return left.entryIndex - right.entryIndex || left.logicalOrdinal - right.logicalOrdinal ||
    left.transmissionOrdinal - right.transmissionOrdinal;
}

/** The ledger is already validated; independent metrics retain their own coverage. */
export function projectJudgeUsage(ledger: JudgeUsageAttachment): JudgeUsage {
  const receipts = new Map(ledger.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  const costCalls = ledger.calls.map((call): { readonly effectiveCost: EffectiveCallCost | null } => {
    const receipt = receipts.get(call.callId);
    return { effectiveCost: call.cost !== null ? { ...call.cost, state: "complete" }
      : receipt === undefined ? null
      : { amount: receipt.amount, currency: receipt.currency, source: receipt.source, state: receipt.state } };
  });
  const costs = effectiveCostTotals(costCalls, ledger.collection.state);
  const numeric = (metric: "inputTotalTokens" | "outputTokens" | "totalTokens") => {
    let value = 0;
    let observationCount = 0;
    let complete = ledger.collection.state === "complete";
    for (const call of ledger.calls) {
      const inputBuckets = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens];
      const knownInputs = inputBuckets.filter((bucket): bucket is number => bucket !== null);
      const input = call.inputTotalTokens ?? (knownInputs.length === 0 ? null
        : knownInputs.reduce((sum, bucket) => sum + bucket, 0));
      const buckets = metric === "inputTotalTokens" ? [input]
        : metric === "outputTokens" ? [call.outputTokens] : [input, call.outputTokens];
      if (buckets.some((bucket) => bucket !== null)) observationCount++;
      for (const bucket of buckets) {
        if (bucket === null) complete = false;
        else value += bucket;
      }
      if (metric !== "outputTokens" && call.inputTotalTokens === null && knownInputs.length !== 3) complete = false;
    }
    if (!Number.isSafeInteger(value) || observationCount === 0 && ledger.calls.length > 0 ||
      ledger.calls.length === 0 && !complete) {
      return Object.freeze({ state: "unavailable" as const, value: null, observationCount });
    }
    return Object.freeze({ state: complete ? "available" as const : "partial" as const, value, observationCount });
  };
  const all: Extract<JudgeUsage, { readonly state: "complete" | "partial" }> = Object.freeze({
    state: ledger.collection.state,
    coverage: "physical-transmissions",
    collection: ledger.collection,
    calls: Object.freeze([...ledger.calls].sort(compareJudgeUsageCalls)),
    callsTruncated: false,
    omittedCallCount: 0,
    totals: Object.freeze({
      requests: Object.freeze({ state: ledger.collection.state === "complete" ? "available" : "partial",
        value: ledger.calls.length, observationCount: ledger.calls.length }),
      inputTotalTokens: numeric("inputTotalTokens"), outputTokens: numeric("outputTokens"), totalTokens: numeric("totalTokens"),
      costs: ledger.collection.state === "complete" && ledger.calls.length === 0
        ? Object.freeze({ ...costs, state: "complete" }) : costs,
    }),
    priceReceipts: ledger.priceReceipts,
  });
  let preview = takeJudgeUsagePreview(all, JUDGE_USAGE_PREVIEW_CALL_LIMIT);
  while (utf8ByteLength(JSON.stringify({ calls: preview.calls, priceReceipts: preview.priceReceipts })) >
    JUDGE_USAGE_PREVIEW_BYTE_LIMIT && preview.calls.length > 0) {
    preview = takeJudgeUsagePreview(preview, preview.calls.length - 1);
  }
  return preview;
}

/** Shrinking details never changes totals and retains only the corresponding price proofs. */
export function takeJudgeUsagePreview(
  usage: Extract<JudgeUsage, { readonly state: "complete" | "partial" }>,
  maximumCalls: number,
): Extract<JudgeUsage, { readonly state: "complete" | "partial" }> {
  const calls = Object.freeze(usage.calls.slice(0, maximumCalls));
  const receipts = new Map(usage.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  const priceReceipts = Object.freeze(calls.flatMap((call) => {
    const receipt = receipts.get(call.callId);
    return receipt === undefined ? [] : [receipt];
  }));
  const omittedCallCount = usage.omittedCallCount + usage.calls.length - calls.length;
  return Object.freeze({ ...usage, calls, priceReceipts, callsTruncated: omittedCallCount > 0, omittedCallCount });
}

export function summarizeJudgeUsage(usage: JudgeUsage): JudgeUsageSummary {
  if (usage.state === "unavailable" || usage.state === "invalid") return usage;
  return Object.freeze({ state: usage.state, coverage: usage.coverage, collection: usage.collection, totals: usage.totals });
}

/** Currency-preserving known subtotals; no exchange rate or fabricated zero currency. */
export function projectTotalUsageCosts(
  application: InspectionAttemptUsageResult["totals"],
  judge: JudgeUsageSummary,
  applicationEmptyComplete = false,
  applicationCollectionProven = true,
): TotalUsageCosts {
  const applicationValues = application.costs !== undefined ? application.costs.values
    : (application.providerCosts?.values ?? []).map(({ currency, value }) => ({ currency, value, source: "reported" as const }));
  const judgeCosts = judge.state === "complete" || judge.state === "partial" ? judge.totals.costs : undefined;
  const completeApplication = applicationCollectionProven && (applicationEmptyComplete || application.costs?.state === "complete" ||
    application.costs === undefined && application.providerCosts?.state === "available");
  const missingSources: ("application" | "judge")[] = [];
  if (!completeApplication) missingSources.push("application");
  if (judgeCosts?.state !== "complete") missingSources.push("judge");
  const values = sumCostValues([...applicationValues, ...(judgeCosts?.values ?? [])]);
  return Object.freeze({ state: missingSources.length === 0 ? "complete" : values.length === 0 ? "unavailable" : "partial",
    values, missingSources: Object.freeze(missingSources) });
}

/** Inputs are unique origin Attempts, never preview rows or verdict-filtered members. */
export function combineTotalUsageCosts(totals: readonly TotalUsageCosts[], unresolved = false): TotalUsageCosts {
  const missingSources = (["application", "judge"] as const).filter((source) =>
    unresolved || totals.some((total) => total.missingSources.includes(source)));
  const values = sumCostValues(totals.flatMap((total) => total.values));
  return Object.freeze({ state: missingSources.length === 0 ? "complete" : values.length === 0 ? "unavailable" : "partial",
    values, missingSources: Object.freeze(missingSources) });
}

function sumCostValues(entries: TotalUsageCosts["values"]): TotalUsageCosts["values"] {
  const grouped = new Map<string, { readonly value: string; readonly source: "reported" | "estimated" | "mixed" }[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.currency);
    if (group === undefined) grouped.set(entry.currency, [entry]);
    else group.push(entry);
  }
  return Object.freeze([...grouped.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([currency, entries]) => Object.freeze({
      currency, value: addCanonicalDecimals(entries.map((entry) => entry.value)),
      source: entries.every((entry) => entry.source === entries[0]!.source) ? entries[0]!.source : "mixed" as const,
    })));
}
