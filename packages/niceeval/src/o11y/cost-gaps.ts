import type { ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import type { JudgeUsageAttachment } from "../record/family/judge-usage/schema.ts";
import { CostGapReasons, CostGapSources, type CostGap, type TotalUsageCosts } from "../inspection/results.ts";
import { compareUtf8 } from "../inspection/bytes.ts";
import { numberedCollectionPage } from "../inspection/collection-page.ts";
import { INSPECTION_COST_GAP_MODEL_PAGE_BYTES, INSPECTION_COST_GAP_MODEL_PAGE_SIZE } from "../inspection/limits.ts";

type RecordedCostGap = Pick<CostGap, "source" | "reason" | "models">;

export type RecordedTotalUsageCosts = Omit<TotalUsageCosts, "gaps"> & { readonly gaps: readonly RecordedCostGap[] };

export function applicationCostGaps(
  ledger: ReadableAdapterUsageAttachment | undefined,
  hasTurnUsage: boolean,
): readonly RecordedCostGap[] {
  if (ledger === undefined && hasTurnUsage) {
    return [{ source: "application", reason: "observed-usage-cost-incomplete", models: [] }];
  }
  return recordedCostGaps("application", ledger);
}

/** Read the full validated ledger, before any public preview is selected. */
export function recordedCostGaps(
  source: "application" | "judge",
  ledger: ReadableAdapterUsageAttachment | JudgeUsageAttachment | undefined,
): readonly RecordedCostGap[] {
  if (ledger === undefined) return [{ source, reason: "usage-not-recorded", models: [] }];
  const gaps: RecordedCostGap[] = [];
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

export function combineCostGaps(gaps: readonly RecordedCostGap[]): readonly RecordedCostGap[] {
  return CostGapSources.flatMap((source) =>
    CostGapReasons.flatMap((reason) => {
      const matching = gaps.filter((gap) => gap.source === source && gap.reason === reason);
      return matching.length === 0
        ? []
        : [{ source, reason, models: [...new Set(matching.flatMap((gap) => gap.models))].sort(compareUtf8) }];
    }),
  );
}

export function pageTotalUsageCosts(costs: RecordedTotalUsageCosts, page: number): TotalUsageCosts {
  return {
    ...costs,
    gaps: costs.gaps.map(({ source, reason, models }) => {
      const { items, omitted } = numberedCollectionPage(
        models,
        page,
        INSPECTION_COST_GAP_MODEL_PAGE_SIZE,
        // The default item size includes a comma. One more byte accounts for the JSON array.
        INSPECTION_COST_GAP_MODEL_PAGE_BYTES - 1,
      );
      return { source, reason, models: items, totalModelCount: models.length, omittedModelCount: omitted };
    }),
  };
}
