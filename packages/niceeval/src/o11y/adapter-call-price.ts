import { Result, Schema } from "effect";
import type { PriceOverride } from "../runner/types.ts";
import {
  AdapterCallPriceReceiptSchema,
  type AdapterCallPriceReceipt,
  type AdapterUsageCall,
} from "../record/family/adapter-usage/schema.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
/*
 * This estimator is independent of Runner maxCost. Its output is decoded by the
 * durable receipt schema before publication so type assertions cannot hide drift.
 */
import {
  AdapterCallPriceBuckets,
  adapterCallPricingProfileDigest,
  addCanonicalDecimals,
  canonicalDecimalFromNumber,
  multiplyCanonicalDecimalPerMillion,
} from "../record/family/adapter-usage/pricing.ts";

interface SelectedProfile {
  readonly basis: "catalog-reference";
  readonly currency: "USD";
  readonly source: {
    readonly kind: "configured-profile";
    readonly id: string;
    readonly asOf: number | null;
  };
  readonly requestModel: string;
  readonly selector: string;
  readonly match: "exact" | "provider-wildcard";
  readonly ratesPerMTok: {
    readonly input: string;
    readonly output: string;
    readonly cacheRead: string | null;
    readonly cacheWrite: string | null;
  };
}

function configuredProfile(
  model: string,
  overrides: Readonly<Record<string, PriceOverride>> | undefined,
): SelectedProfile | undefined {
  if (overrides === undefined) return undefined;
  const wildcard = model.includes("/") ? `${model.slice(0, model.indexOf("/"))}/*` : undefined;
  const selector = overrides[model] !== undefined ? model
    : wildcard !== undefined && overrides[wildcard] !== undefined ? wildcard
    : undefined;
  if (selector === undefined) return undefined;
  const value = overrides[selector]!;
  if (value.basis !== undefined && value.basis !== "catalog-reference" ||
    value.currency !== undefined && value.currency !== "USD") return undefined;
  const sourceId = value.source?.id ?? "niceeval.config.pricing";
  const asOf = value.source?.asOf ?? null;
  const input = canonicalDecimalFromNumber(value.inputPerMTok);
  const output = canonicalDecimalFromNumber(value.outputPerMTok);
  if (input === undefined || output === undefined || sourceId.trim().length === 0 ||
    new TextEncoder().encode(sourceId).byteLength > 256 || /[\u0000-\u001f\u007f]/u.test(sourceId) ||
    asOf !== null && (!Number.isSafeInteger(asOf) || asOf <= 0)) return undefined;
  return Object.freeze({
    basis: "catalog-reference",
    currency: "USD",
    source: Object.freeze({ kind: "configured-profile", id: sourceId, asOf }),
    requestModel: model,
    selector,
    match: selector === model ? "exact" : "provider-wildcard",
    ratesPerMTok: Object.freeze({
      input,
      output,
      cacheRead: value.cacheReadPerMTok === undefined
        ? null
        : canonicalDecimalFromNumber(value.cacheReadPerMTok) ?? null,
      cacheWrite: value.cacheWritePerMTok === undefined
        ? null
        : canonicalDecimalFromNumber(value.cacheWritePerMTok) ?? null,
    }),
  });
}

function tokensFor(call: AdapterUsageCall, bucket: (typeof AdapterCallPriceBuckets)[number]): number | null {
  switch (bucket) {
    case "input": return call.inputTokens;
    case "output": return call.outputTokens;
    case "cache-read": return call.cacheReadTokens;
    case "cache-write": return call.cacheWriteTokens;
  }
}

function rateFor(profile: SelectedProfile, bucket: (typeof AdapterCallPriceBuckets)[number]): string | null {
  switch (bucket) {
    case "input": return profile.ratesPerMTok.input;
    case "output": return profile.ratesPerMTok.output;
    case "cache-read": return profile.ratesPerMTok.cacheRead;
    case "cache-write": return profile.ratesPerMTok.cacheWrite;
  }
}

function receiptFor(
  call: AdapterUsageCall,
  overrides: Readonly<Record<string, PriceOverride>> | undefined,
): AdapterCallPriceReceipt | undefined {
  if (call.cost !== null || call.model === null) return undefined;
  // The vendored builtin catalog has no independent flat-applicability proof. It is not used here.
  const selected = configuredProfile(call.model, overrides);
  if (selected === undefined) return undefined;
  const digestInput = {
    basis: selected.basis,
    currency: selected.currency,
    source: selected.source,
    requestModel: selected.requestModel,
    selector: selected.selector,
    match: selected.match,
    ratesPerMTok: selected.ratesPerMTok,
  };
  const pricing = Object.freeze({
    ...digestInput,
    source: Object.freeze({
      ...selected.source,
      profileDigest: adapterCallPricingProfileDigest(digestInput),
    }),
  });
  const charges: Array<Record<string, unknown>> = [];
  const missing: Array<Record<string, unknown>> = [];
  for (const bucket of AdapterCallPriceBuckets) {
    const tokens = tokensFor(call, bucket);
    const rate = rateFor(selected, bucket);
    if (tokens === null) {
      missing.push(Object.freeze({ bucket, reason: "tokens-unknown" }));
    } else if (tokens === 0) {
      charges.push(Object.freeze({ bucket, tokens, ratePerMTok: rate, amount: "0" }));
    } else if (rate === null) {
      missing.push(Object.freeze({ bucket, reason: "rate-unknown" }));
    } else {
      charges.push(Object.freeze({
        bucket,
        tokens,
        ratePerMTok: rate,
        amount: multiplyCanonicalDecimalPerMillion(rate, tokens),
      }));
    }
  }
  if (charges.length === 0) return undefined;
  const receipt = Schema.decodeUnknownResult(
    AdapterCallPriceReceiptSchema,
    RecordExactParseOptions,
  )({
    kind: "adapter-call-price-estimate",
    callId: call.callId,
    state: missing.length === 0 ? "complete" : "partial",
    amount: addCanonicalDecimals(charges.map((charge) => String(charge.amount))),
    currency: "USD",
    source: Object.freeze({ kind: "estimated", id: selected.source.id }),
    pricing,
    charges: Object.freeze(charges),
    missing: Object.freeze(missing),
  });
  if (Result.isFailure(receipt)) {
    throw new Error("Generated Adapter call price receipt is invalid");
  }
  return Object.freeze(receipt.success);
}

export function createAdapterCallPriceReceipts(
  calls: readonly AdapterUsageCall[],
  overrides: Readonly<Record<string, PriceOverride>> | undefined,
): readonly AdapterCallPriceReceipt[] {
  return Object.freeze(calls.flatMap((call) => {
    const receipt = receiptFor(call, overrides);
    return receipt === undefined ? [] : [receipt];
  }));
}
