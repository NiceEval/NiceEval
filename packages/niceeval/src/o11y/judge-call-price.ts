import { Result, Schema } from "effect";
import type { PriceOverride } from "../runner/types.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { JudgePriceReceiptSchema, type JudgePriceReceipt, type JudgeUsageCall } from "../record/family/judge-usage/schema.ts";
import {
  AdapterCallPriceBuckets, adapterCallPricingProfileDigest,
  addCanonicalDecimals, multiplyCanonicalDecimalPerMillion,
} from "../record/family/adapter-usage/pricing.ts";
import { configuredProfile, rateFor } from "./adapter-call-price.ts";

function tokensFor(call: JudgeUsageCall, bucket: (typeof AdapterCallPriceBuckets)[number]): number | null {
  switch (bucket) {
    case "input": return call.inputTokens;
    case "output": return call.outputTokens;
    case "cache-read": return call.cacheReadTokens;
    case "cache-write": return call.cacheWriteTokens;
  }
}

export function createJudgeCallPriceReceipts(
  calls: readonly JudgeUsageCall[],
  pricing: Readonly<Record<string, PriceOverride>> | undefined,
): readonly JudgePriceReceipt[] {
  return Object.freeze(calls.flatMap((call): readonly JudgePriceReceipt[] => {
    // A reported zero is a complete reported observation, not a missing price.
    if (call.cost !== null) return [];
    const selected = configuredProfile(call.requestModel, pricing);
    if (selected === undefined) return [];
    const digestInput = {
      basis: selected.basis, currency: selected.currency, source: selected.source,
      requestModel: selected.requestModel, selector: selected.selector,
      match: selected.match, ratesPerMTok: selected.ratesPerMTok,
    };
    const charges: Array<Record<string, unknown>> = [];
    const missing: Array<Record<string, unknown>> = [];
    for (const bucket of AdapterCallPriceBuckets) {
      const tokens = tokensFor(call, bucket);
      const rate = rateFor(selected, bucket);
      if (tokens === null) missing.push({ bucket, reason: "tokens-unknown" });
      else if (tokens === 0) charges.push({ bucket, tokens, ratePerMTok: rate, amount: "0" });
      else if (rate === null) missing.push({ bucket, reason: "rate-unknown" });
      else charges.push({ bucket, tokens, ratePerMTok: rate, amount: multiplyCanonicalDecimalPerMillion(rate, tokens) });
    }
    if (charges.length === 0) return [];
    const decoded = Schema.decodeUnknownResult(JudgePriceReceiptSchema, RecordExactParseOptions)({
      kind: "judge-call-price-estimate", callId: call.callId,
      state: missing.length === 0 ? "complete" : "partial",
      amount: addCanonicalDecimals(charges.map((charge) => String(charge.amount))),
      currency: "USD", source: { kind: "estimated", id: selected.source.id },
      pricing: {
        ...digestInput,
        source: { ...selected.source, profileDigest: adapterCallPricingProfileDigest(digestInput) },
      },
      charges, missing,
    });
    if (Result.isFailure(decoded)) throw new Error("Generated Judge call price receipt is invalid");
    return [Object.freeze(decoded.success)];
  }));
}
