import type { ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import type { JudgeUsageAttachment } from "../record/family/judge-usage/schema.ts";
import { CostGapReasons, CostGapSources, type CostGap } from "../inspection/results.ts";

/** Read the full validated ledger, before any public preview is selected. */
export function recordedCostGaps(
  source: "application" | "judge",
  ledger: ReadableAdapterUsageAttachment | JudgeUsageAttachment | undefined,
): readonly CostGap[] {
  if (ledger === undefined) return [{ source, reason: "usage-not-recorded", models: [] }];
  const gaps: CostGap[] = [];
  const receipts = new Map(ledger.priceReceipts.map((receipt) => [receipt.callId, receipt]));
  if (ledger.collection.state !== "complete") gaps.push({ source, reason: "usage-not-recorded", models: [] });
  for (const call of ledger.calls) {
    if (call.cost !== null) continue;
    const receipt = receipts.get(call.callId);
    if (receipt !== undefined) {
      if (receipt.missing.some((bucket) => bucket.reason === "rate-unknown")) {
        gaps.push({ source, reason: "no-pricing-profile", models: [receipt.pricing.requestModel] });
      }
      if (receipt.missing.some((bucket) => bucket.reason === "tokens-unknown")) {
        gaps.push({ source, reason: "token-buckets-incomplete", models: [] });
      }
      continue;
    }
    const model = "requestModel" in call ? call.requestModel : call.model;
    // A matching profile always seals a charge for a known input/output bucket,
    // including zero. Cache-only evidence cannot prove whether a profile matched.
    if (model !== null && (call.inputTokens !== null || call.outputTokens !== null)) {
      gaps.push({ source, reason: "no-pricing-profile", models: [model] });
    } else {
      gaps.push({ source, reason: "provider-cost-not-reported", models: [] });
    }
  }
  return combineCostGaps(gaps);
}

export function combineCostGaps(gaps: readonly CostGap[]): readonly CostGap[] {
  return CostGapSources.flatMap((source) => CostGapReasons.flatMap((reason) => {
    const matching = gaps.filter((gap) => gap.source === source && gap.reason === reason);
    return matching.length === 0 ? [] : [{ source, reason,
      models: [...new Set(matching.flatMap((gap) => gap.models))].sort() }];
  }));
}
