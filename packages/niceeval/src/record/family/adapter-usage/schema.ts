import { Schema } from "effect";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { CollectionStateSchema, NonNegativeSafeIntegerSchema, PositiveSafeIntegerSchema } from "../common.ts";
import { CanonicalDecimalSchema, CurrencyCodeSchema } from "../source-receipt/codec.ts";
import {
  AdapterCallPriceBuckets,
  adapterCallPricingProfileDigest,
  addCanonicalDecimals,
  multiplyCanonicalDecimalPerMillion,
} from "./pricing.ts";

const Identity = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256 && !/[\u0000-\u001f\u007f]/u.test(value),
)));
const Tokens = Schema.NullOr(NonNegativeSafeIntegerSchema);
const AdapterUsageCallRevision1Schema = Schema.Struct({
  callId: Identity,
  retryOf: Schema.NullOr(Identity),
  provider: Schema.NullOr(Identity),
  model: Schema.NullOr(Identity),
  status: Schema.Literals(["succeeded", "failed", "cancelled", "unknown"]),
  inputTokens: Tokens,
  inputTotalTokens: Tokens,
  outputTokens: Tokens,
  cacheReadTokens: Tokens,
  cacheWriteTokens: Tokens,
});
const AdapterUsageRouteSchema = Schema.Struct({
  transportProvider: Schema.NullOr(Identity),
  endpointId: Schema.NullOr(Identity),
});
const AdapterUsageReportedCostSchema = Schema.Struct({
  amount: CanonicalDecimalSchema,
  currency: CurrencyCodeSchema,
  source: Schema.Struct({ kind: Schema.Literal("reported"), id: Identity }),
});
const Digest = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => /^sha256:[0-9a-f]{64}$/u.test(value),
)));
const NullableRateSchema = Schema.NullOr(CanonicalDecimalSchema);
const AdapterCallPriceRatesSchema = Schema.Struct({
  input: NullableRateSchema,
  output: NullableRateSchema,
  cacheRead: NullableRateSchema,
  cacheWrite: NullableRateSchema,
});
const AdapterCallPriceSourceSchema = Schema.Struct({
  kind: Schema.Literal("configured-profile"),
  id: Identity,
  asOf: Schema.NullOr(PositiveSafeIntegerSchema),
  profileDigest: Digest,
});
const AdapterCallPricingSchema = Schema.Struct({
  basis: Schema.Literal("catalog-reference"),
  currency: Schema.Literal("USD"),
  source: AdapterCallPriceSourceSchema,
  requestModel: Identity,
  selector: Identity,
  match: Schema.Literals(["exact", "provider-wildcard"]),
  ratesPerMTok: AdapterCallPriceRatesSchema,
});
const AdapterCallPriceChargeSchema = Schema.Struct({
  bucket: Schema.Literals(AdapterCallPriceBuckets),
  tokens: NonNegativeSafeIntegerSchema,
  ratePerMTok: NullableRateSchema,
  amount: CanonicalDecimalSchema,
});
const AdapterCallPriceMissingSchema = Schema.Struct({
  bucket: Schema.Literals(AdapterCallPriceBuckets),
  reason: Schema.Literals(["tokens-unknown", "rate-unknown"]),
});
export const AdapterCallPriceReceiptSchema = Schema.Struct({
  kind: Schema.Literal("adapter-call-price-estimate"),
  callId: Identity,
  state: Schema.Literals(["complete", "partial"]),
  amount: CanonicalDecimalSchema,
  currency: Schema.Literal("USD"),
  source: Schema.Struct({ kind: Schema.Literal("estimated"), id: Identity }),
  pricing: AdapterCallPricingSchema,
  charges: Schema.NonEmptyArray(AdapterCallPriceChargeSchema),
  missing: Schema.Array(AdapterCallPriceMissingSchema),
});
export type AdapterCallPriceReceipt = Schema.Schema.Type<typeof AdapterCallPriceReceiptSchema>;
export const AdapterUsageCallSchema = Schema.Struct({
  ...AdapterUsageCallRevision1Schema.fields,
  route: AdapterUsageRouteSchema,
  cost: Schema.NullOr(AdapterUsageReportedCostSchema),
});
export type AdapterUsageCall = Schema.Schema.Type<typeof AdapterUsageCallSchema>;
export const AdapterUsageLimits = Object.freeze({ maximumCalls: 4_000 });
export const AdapterUsageAttachmentRevision1Schema = Schema.Struct({
  collection: CollectionStateSchema,
  calls: Schema.Array(AdapterUsageCallRevision1Schema),
});
export type AdapterUsageAttachmentRevision1 = Schema.Schema.Type<typeof AdapterUsageAttachmentRevision1Schema>;
export const AdapterUsageAttachmentSchema = Schema.Struct({
  collection: CollectionStateSchema,
  calls: Schema.Array(AdapterUsageCallSchema),
  /** Estimates only for calls without a reported cost and with at least one proven charge. */
  priceReceipts: Schema.Array(AdapterCallPriceReceiptSchema),
});
export type AdapterUsageAttachment = Schema.Schema.Type<typeof AdapterUsageAttachmentSchema>;
export interface ReadableAdapterUsageAttachment {
  readonly collection: AdapterUsageAttachment["collection"];
  readonly calls: AdapterUsageAttachment["calls"];
  /** null means revision 1 contained no call-bound estimate proofs. */
  readonly priceReceipts: AdapterUsageAttachment["priceReceipts"] | null;
}

/** Valid revision 1 facts remain readable without rewriting bytes or repricing historical calls. */
export function projectAdapterUsageRevision1(
  value: AdapterUsageAttachmentRevision1,
): ReadableAdapterUsageAttachment {
  return Object.freeze({
    collection: value.collection,
    calls: Object.freeze(value.calls.map((call) => Object.freeze({
      ...call,
      route: Object.freeze({ transportProvider: null, endpointId: null }),
      cost: null,
    }))),
    priceReceipts: null,
  });
}

function pricingDigestInput(pricing: AdapterCallPriceReceipt["pricing"]): object {
  const source = { kind: pricing.source.kind, id: pricing.source.id, asOf: pricing.source.asOf };
  return {
    basis: pricing.basis,
    currency: "USD",
    source,
    requestModel: pricing.requestModel,
    selector: pricing.selector,
    match: pricing.match,
    ratesPerMTok: pricing.ratesPerMTok,
  };
}

function callTokens(call: AdapterUsageCall, bucket: (typeof AdapterCallPriceBuckets)[number]): number | null {
  switch (bucket) {
    case "input": return call.inputTokens;
    case "output": return call.outputTokens;
    case "cache-read": return call.cacheReadTokens;
    case "cache-write": return call.cacheWriteTokens;
  }
}

function bucketRate(
  rates: AdapterCallPriceReceipt["pricing"]["ratesPerMTok"],
  bucket: (typeof AdapterCallPriceBuckets)[number],
): string | null {
  switch (bucket) {
    case "input": return rates.input;
    case "output": return rates.output;
    case "cache-read": return rates.cacheRead;
    case "cache-write": return rates.cacheWrite;
  }
}

function receiptIssue(call: AdapterUsageCall, receipt: AdapterCallPriceReceipt): RecordAttachmentIssue | undefined {
  if (receipt.callId !== call.callId || call.cost !== null || receipt.pricing.requestModel !== call.model ||
    receipt.source.id !== receipt.pricing.source.id ||
    adapterCallPricingProfileDigest(pricingDigestInput(receipt.pricing)) !== receipt.pricing.source.profileDigest) {
    return recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "pricing"]);
  }
  const charges = new Map(receipt.charges.map((charge) => [charge.bucket, charge]));
  const missing = new Map(receipt.missing.map((entry) => [entry.bucket, entry]));
  if (charges.size !== receipt.charges.length || missing.size !== receipt.missing.length ||
    AdapterCallPriceBuckets.some((bucket) => Number(charges.has(bucket)) + Number(missing.has(bucket)) !== 1)) {
    return recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "charges"]);
  }
  for (const bucket of AdapterCallPriceBuckets) {
    const tokens = callTokens(call, bucket);
    const expectedRate = bucketRate(receipt.pricing.ratesPerMTok, bucket);
    const charge = charges.get(bucket);
    const absent = missing.get(bucket);
    if (charge !== undefined) {
      if (tokens === null || charge.tokens !== tokens || charge.ratePerMTok !== expectedRate ||
        (tokens > 0 && expectedRate === null) ||
        charge.amount !== (expectedRate === null ? "0" : multiplyCanonicalDecimalPerMillion(expectedRate, tokens))) {
        return recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "charges"]);
      }
    } else if (tokens === null
      ? absent?.reason !== "tokens-unknown"
      : tokens === 0 || expectedRate !== null || absent?.reason !== "rate-unknown") {
      return recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "missing"]);
    }
  }
  const state = receipt.missing.length === 0 ? "complete" : "partial";
  const amount = addCanonicalDecimals(receipt.charges.map((charge) => charge.amount));
  if (receipt.state !== state || receipt.amount !== amount) {
    return recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "state"]);
  }
  return undefined;
}

export function validateAdapterUsageCalls(calls: readonly AdapterUsageCall[]): readonly RecordAttachmentIssue[] {
  const seen = new Set<string>();
  for (const call of calls) {
    const buckets = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens];
    const known = buckets.filter((value): value is number => value !== null);
    const sum = known.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum) || (call.inputTotalTokens !== null &&
      (sum > call.inputTotalTokens || (known.length === 3 && sum !== call.inputTotalTokens)))) {
      return [recordAttachmentIssue("record-attachment-schema-invalid", ["calls", "inputTotalTokens"])];
    }
    if (seen.has(call.callId) || (call.retryOf !== null && !seen.has(call.retryOf))) {
      return [recordAttachmentIssue("record-attachment-schema-invalid", ["calls"])];
    }
    seen.add(call.callId);
  }
  return calls.length > AdapterUsageLimits.maximumCalls
    ? [recordAttachmentIssue("record-attachment-schema-invalid", ["calls"])]
    : [];
}

export function validateAdapterUsageAttachment(value: ReadableAdapterUsageAttachment): readonly RecordAttachmentIssue[] {
  const callIssues = validateAdapterUsageCalls(value.calls);
  if (callIssues.length > 0 || value.priceReceipts === null) return callIssues;
  const calls = new Map(value.calls.map((call) => [call.callId, call]));
  const seen = new Set<string>();
  for (const receipt of value.priceReceipts) {
    const call = calls.get(receipt.callId);
    if (call === undefined || seen.has(receipt.callId)) {
      return [recordAttachmentIssue("record-attachment-schema-invalid", ["priceReceipts", "callId"])];
    }
    seen.add(receipt.callId);
    const issue = receiptIssue(call, receipt);
    if (issue !== undefined) return [issue];
  }
  return [];
}
