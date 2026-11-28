import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { PriceOverride } from "../runner/types.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import {
  JudgePriceReceiptSchema,
  type JudgePriceReceipt,
  type JudgeUsageCall,
} from "../record/family/judge-usage/schema.ts";
import {
  AdapterCallPriceBuckets,
  adapterCallPricingProfileDigest,
  addCanonicalDecimals,
  multiplyCanonicalDecimalPerMillion,
} from "../record/family/adapter-usage/pricing.ts";
import { configuredProfile, rateFor } from "./adapter-call-price.ts";

type CallPriceTokens = Pick<JudgeUsageCall, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">;
type JudgePriceReceiptInput = typeof JudgePriceReceiptSchema.Encoded;
type JudgePricingProfile = JudgePriceReceipt["pricing"];
export type BuiltinCallPriceProfile = Pick<JudgePricingProfile, "basis" | "currency" | "requestModel" | "selector"> &
  Parameters<typeof rateFor>[0] & {
    readonly match: "builtin-catalog";
    readonly source: Omit<Extract<JudgePricingProfile["source"], { kind: "builtin-catalog" }>, "profileDigest">;
  };

function tokensFor(call: CallPriceTokens, bucket: (typeof AdapterCallPriceBuckets)[number]): number | null {
  switch (bucket) {
    case "input":
      return call.inputTokens;
    case "output":
      return call.outputTokens;
    case "cache-read":
      return call.cacheReadTokens;
    case "cache-write":
      return call.cacheWriteTokens;
  }
}

export function estimateCallPrice(tokens: CallPriceTokens, profile: Parameters<typeof rateFor>[0]) {
  const charges: JudgePriceReceiptInput["charges"][number][] = [];
  const missing: JudgePriceReceipt["missing"][number][] = [];
  for (const bucket of AdapterCallPriceBuckets) {
    const count = tokensFor(tokens, bucket);
    const rate = rateFor(profile, bucket);
    if (count === null) missing.push({ bucket, reason: "tokens-unknown" });
    else if (count === 0) charges.push({ bucket, tokens: count, ratePerMTok: rate, amount: "0" });
    else if (rate === null) missing.push({ bucket, reason: "rate-unknown" });
    else
      charges.push({
        bucket,
        tokens: count,
        ratePerMTok: rate,
        amount: multiplyCanonicalDecimalPerMillion(rate, count),
      });
  }
  return { charges, missing, amount: addCanonicalDecimals(charges.map((charge) => charge.amount)) };
}

export function createJudgeCallPriceReceipts(
  calls: readonly JudgeUsageCall[],
  pricing: Readonly<Record<string, PriceOverride>> | undefined,
  builtinPrice?: (model: string) => BuiltinCallPriceProfile | undefined,
): readonly JudgePriceReceipt[] {
  return calls.flatMap((call): readonly JudgePriceReceipt[] => {
    // A reported zero is a complete reported observation, not a missing price.
    if (call.cost !== null) return [];
    const selected = configuredProfile(call.requestModel, pricing) ?? builtinPrice?.(call.requestModel);
    if (selected === undefined) return [];
    const digestInput = {
      basis: selected.basis,
      currency: selected.currency,
      source: selected.source,
      requestModel: selected.requestModel,
      selector: selected.selector,
      match: selected.match,
      ratesPerMTok: selected.ratesPerMTok,
    };
    const { charges, missing, amount } = estimateCallPrice(call, selected);
    if (charges.length === 0) return [];
    const decoded = Schema.decodeUnknownResult(
      JudgePriceReceiptSchema,
      RecordExactParseOptions,
    )({
      kind: "judge-call-price-estimate",
      callId: call.callId,
      state: missing.length === 0 ? "complete" : "partial",
      amount,
      currency: "USD",
      source: { kind: "estimated", id: selected.source.id },
      pricing: {
        ...digestInput,
        source: { ...selected.source, profileDigest: adapterCallPricingProfileDigest(digestInput) },
      },
      charges,
      missing,
    });
    if (Result.isFailure(decoded)) throw new Error("Generated Judge call price receipt is invalid");
    return [decoded.success];
  });
}
