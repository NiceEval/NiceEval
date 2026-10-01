import { Schema } from "effect";
import { AssertionEntryIdSchema } from "../../../assertions/record/codec.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { CollectionStateSchema, FiniteNonNegativeNumberSchema, NonNegativeSafeIntegerSchema, PositiveSafeIntegerSchema } from "../common.ts";
import { CanonicalDecimalSchema, CurrencyCodeSchema } from "../source-receipt/codec.ts";
import {
  AdapterCallPriceBuckets,
  adapterCallPricingProfileDigest,
  addCanonicalDecimals,
  canonicalDecimalFromNumber,
  multiplyCanonicalDecimalPerMillion,
} from "../adapter-usage/pricing.ts";

export const JudgeUsageLimits = Object.freeze({
  maximumCalls: 4_000,
  maximumModelBytes: 8_192,
  maximumReceiptBytes: 32_768,
  maximumReceiptFields: 24,
});

const encoder = new TextEncoder();
function boundedIdentity(maximumBytes: number) {
  return Schema.String.check(Schema.makeFilter((value) =>
    value.trim().length > 0 && !/[\ud800-\udfff]/u.test(value) &&
    encoder.encode(value).byteLength <= maximumBytes && !/[\u0000-\u001f\u007f]/u.test(value),
  ));
}
const Identity = boundedIdentity(256);
/** @internal Used to validate observations before retaining their response fields. */
export const JudgeUsageModelSchema = boundedIdentity(JudgeUsageLimits.maximumModelBytes);
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u));
const Tokens = Schema.NullOr(NonNegativeSafeIntegerSchema);
const NullableRate = Schema.NullOr(CanonicalDecimalSchema);

/** Only these protocol facts may enter durable receipts; business text is excluded. */
export const JudgeUsageReceiptPaths = Object.freeze([
  "model",
  "provider",
  "usage.completion_tokens",
  "usage.cost",
  "usage.input_tokens",
  "usage.output_tokens",
  "usage.prompt_tokens",
  "usage.prompt_tokens_details.cache_write_tokens",
  "usage.prompt_tokens_details.cached_tokens",
  "usage.total_tokens",
] as const);

const ReceiptFieldSchema = Schema.Struct({
  path: Schema.Literals(JudgeUsageReceiptPaths),
  value: Schema.Union([Schema.String.check(Schema.makeFilter((value) =>
    !/[\ud800-\udfff]/u.test(value) && encoder.encode(value).byteLength <= JudgeUsageLimits.maximumModelBytes &&
    !/[\u0000-\u001f\u007f]/u.test(value),
  )), FiniteNonNegativeNumberSchema.check(Schema.makeFilter((value) => !Object.is(value, -0))), Schema.Null]),
});
const ReceiptSchema = Schema.Struct({
  state: Schema.Literals(["available", "unavailable"]),
  reason: Schema.NullOr(Schema.Literals([
    "response-unavailable", "cancelled", "response-too-large", "invalid-json",
    "usage-not-reported", "invalid-usage", "response-model-too-large",
  ])),
  responseDigest: Schema.NullOr(Digest),
  fields: Schema.Array(ReceiptFieldSchema),
}).check(Schema.makeFilter((receipt) => {
  if (receipt.fields.length > JudgeUsageLimits.maximumReceiptFields ||
    encoder.encode(JSON.stringify(receipt)).byteLength > JudgeUsageLimits.maximumReceiptBytes ||
    receipt.fields.some((field, index) => index > 0 && receipt.fields[index - 1]!.path >= field.path)) return false;
  if (receipt.state === "available") {
    return receipt.fields.some((field) => field.value !== null) && receipt.responseDigest !== null &&
      (receipt.reason === null || receipt.reason === "invalid-usage" ||
        receipt.reason === "usage-not-reported" || receipt.reason === "response-model-too-large");
  }
  return receipt.fields.length === 0 && receipt.reason !== null &&
    (receipt.reason === "invalid-json" || receipt.reason === "invalid-usage" ||
      receipt.reason === "usage-not-reported" || receipt.reason === "response-model-too-large"
      ? receipt.responseDigest !== null : receipt.responseDigest === null);
}));

const CallShapeSchema = Schema.Struct({
  callId: Identity,
  entryIndex: NonNegativeSafeIntegerSchema,
  entryId: AssertionEntryIdSchema,
  logicalOrdinal: PositiveSafeIntegerSchema,
  transmissionOrdinal: PositiveSafeIntegerSchema,
  operation: Schema.Literals(["score", "classify", "extract", "batchClassify"]),
  requestModel: JudgeUsageModelSchema,
  transportProvider: Schema.Literals(["openai", "vercel", "openrouter", "typesafe"]),
  provider: Schema.NullOr(Identity),
  model: Schema.NullOr(JudgeUsageModelSchema),
  status: Schema.Literals(["succeeded", "failed", "cancelled", "unknown"]),
  httpStatus: Schema.NullOr(NonNegativeSafeIntegerSchema.check(Schema.makeFilter((value) => value >= 100 && value <= 599))),
  inputTokens: Tokens,
  inputTotalTokens: Tokens,
  outputTokens: Tokens,
  cacheReadTokens: Tokens,
  cacheWriteTokens: Tokens,
  cost: Schema.NullOr(Schema.Struct({
    amount: CanonicalDecimalSchema,
    currency: CurrencyCodeSchema,
    source: Schema.Struct({ kind: Schema.Literal("reported"), id: Identity }),
  })),
  receipt: ReceiptSchema,
});
export type JudgeUsageCall = Schema.Schema.Type<typeof CallShapeSchema>;
export const JudgeUsageCallSchema = CallShapeSchema.check(Schema.makeFilter((call) => validCall(call)));

const PriceReceiptShapeSchema = Schema.Struct({
  kind: Schema.Literal("judge-call-price-estimate"),
  callId: Identity,
  state: Schema.Literals(["complete", "partial"]),
  amount: CanonicalDecimalSchema,
  currency: Schema.Literal("USD"),
  source: Schema.Struct({ kind: Schema.Literal("estimated"), id: Identity }),
  pricing: Schema.Struct({
    basis: Schema.Literal("catalog-reference"),
    currency: Schema.Literal("USD"),
    source: Schema.Struct({
      kind: Schema.Literal("configured-profile"), id: Identity,
      asOf: Schema.NullOr(PositiveSafeIntegerSchema), profileDigest: Digest,
    }),
    requestModel: JudgeUsageModelSchema,
    selector: JudgeUsageModelSchema,
    match: Schema.Literals(["exact", "provider-wildcard"]),
    ratesPerMTok: Schema.Struct({ input: NullableRate, output: NullableRate, cacheRead: NullableRate, cacheWrite: NullableRate }),
  }),
  charges: Schema.NonEmptyArray(Schema.Struct({
    bucket: Schema.Literals(AdapterCallPriceBuckets), tokens: NonNegativeSafeIntegerSchema,
    ratePerMTok: NullableRate, amount: CanonicalDecimalSchema,
  })),
  missing: Schema.Array(Schema.Struct({
    bucket: Schema.Literals(AdapterCallPriceBuckets), reason: Schema.Literals(["tokens-unknown", "rate-unknown"]),
  })),
});
export type JudgePriceReceipt = Schema.Schema.Type<typeof PriceReceiptShapeSchema>;
export const JudgePriceReceiptSchema = PriceReceiptShapeSchema.check(Schema.makeFilter((receipt) => validPriceReceipt(receipt)));

const AttachmentSchema = Schema.Struct({
  collection: CollectionStateSchema,
  calls: Schema.Array(JudgeUsageCallSchema),
  priceReceipts: Schema.Array(JudgePriceReceiptSchema),
});
export type JudgeUsageAttachment = Schema.Schema.Type<typeof AttachmentSchema>;
export const JudgeUsageAttachmentSchema = AttachmentSchema.check(Schema.makeFilter((value) =>
  validateJudgeUsageAttachment(value).length === 0,
));

function validCall(call: JudgeUsageCall): boolean {
  if (call.callId !== `judge:${call.entryIndex}:${call.logicalOrdinal}:${call.transmissionOrdinal}`) return false;
  const buckets = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens];
  const known = buckets.filter((value): value is number => value !== null);
  const sum = known.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum) || call.inputTotalTokens !== null &&
    (sum > call.inputTotalTokens || known.length === 3 && sum !== call.inputTotalTokens)) return false;
  if (call.inputTotalTokens !== null && call.outputTokens !== null &&
    !Number.isSafeInteger(call.inputTotalTokens + call.outputTokens)) return false;
  const fields = new Map(call.receipt.fields.map((field) => [field.path, field.value]));
  for (const field of call.receipt.fields) {
    if (field.value === null) continue;
    if (field.path === "model") {
      if (typeof field.value !== "string" || !Schema.is(JudgeUsageModelSchema)(field.value)) return false;
    } else if (field.path === "provider") {
      if (call.transportProvider !== "openrouter" || typeof field.value !== "string" || !Schema.is(Identity)(field.value)) return false;
    } else if (field.path === "usage.cost") {
      const amount = typeof field.value === "number" ? canonicalDecimalFromNumber(field.value) : field.value;
      if (call.transportProvider !== "openrouter" || amount === undefined || !Schema.is(CanonicalDecimalSchema)(amount)) return false;
    } else if (typeof field.value !== "number" || !Schema.is(NonNegativeSafeIntegerSchema)(field.value) ||
      (call.transportProvider === "typesafe"
        ? !["usage.input_tokens", "usage.output_tokens", "usage.total_tokens"].includes(field.path)
        : ["usage.input_tokens", "usage.output_tokens"].includes(field.path)) ||
      field.path === "usage.prompt_tokens_details.cache_write_tokens" && call.transportProvider !== "openrouter") return false;
  }
  if ((fields.get("model") ?? null) !== call.model || (fields.get("provider") ?? null) !== call.provider) return false;
  const inputPath = call.transportProvider === "typesafe" ? "usage.input_tokens" : "usage.prompt_tokens";
  const outputPath = call.transportProvider === "typesafe" ? "usage.output_tokens" : "usage.completion_tokens";
  if (call.inputTotalTokens !== null && fields.get(inputPath) !== call.inputTotalTokens ||
    call.outputTokens !== null && fields.get(outputPath) !== call.outputTokens) return false;
  if (call.receipt.reason !== "invalid-usage" &&
    (typeof fields.get(inputPath) === "number" && call.inputTotalTokens === null ||
      typeof fields.get(outputPath) === "number" && call.outputTokens === null ||
      typeof fields.get("usage.prompt_tokens_details.cached_tokens") === "number" && call.cacheReadTokens === null ||
      typeof fields.get("usage.prompt_tokens_details.cache_write_tokens") === "number" && call.cacheWriteTokens === null)) return false;
  const total = fields.get("usage.total_tokens");
  if (typeof total === "number" &&
    (call.inputTotalTokens !== null && call.inputTotalTokens > total ||
      call.outputTokens !== null && call.outputTokens > total ||
      call.inputTotalTokens !== null && call.outputTokens !== null && call.inputTotalTokens + call.outputTokens !== total)) return false;
  if (call.transportProvider === "typesafe" && buckets.some((value) => value !== null)) return false;
  if (call.transportProvider !== "typesafe" && call.inputTotalTokens === 0 && buckets.some((value) => value !== 0)) return false;
  if (call.cacheReadTokens !== null && fields.get("usage.prompt_tokens_details.cached_tokens") !== call.cacheReadTokens &&
    !(call.inputTotalTokens === 0 && call.cacheReadTokens === 0 && !fields.has("usage.prompt_tokens_details.cached_tokens"))) return false;
  if (call.cacheWriteTokens !== null && fields.get("usage.prompt_tokens_details.cache_write_tokens") !== call.cacheWriteTokens &&
    !(call.inputTotalTokens === 0 && call.cacheWriteTokens === 0 && !fields.has("usage.prompt_tokens_details.cache_write_tokens"))) return false;
  if (call.inputTokens !== null && (call.inputTotalTokens === null || call.cacheReadTokens === null || call.cacheWriteTokens === null ||
    call.inputTokens !== call.inputTotalTokens - call.cacheReadTokens - call.cacheWriteTokens)) return false;
  if (call.inputTotalTokens !== null && call.cacheReadTokens !== null && call.cacheWriteTokens !== null && call.inputTokens === null) return false;
  const rawCost = fields.get("usage.cost");
  if (rawCost !== undefined && rawCost !== null && call.cost === null) return false;
  if (call.cost !== null) {
    const raw = rawCost;
    const amount = typeof raw === "number" ? canonicalDecimalFromNumber(raw) : raw;
    if (call.transportProvider !== "openrouter" || call.cost.currency !== "USD" ||
      call.cost.source.id !== "openrouter.usage.cost" || call.cost.amount !== amount) return false;
  }
  return true;
}

function validPriceReceipt(receipt: JudgePriceReceipt): boolean {
  const profile = receipt.pricing;
  const expectedSelector = profile.match === "exact" ? profile.requestModel
    : profile.requestModel.includes("/") ? `${profile.requestModel.slice(0, profile.requestModel.indexOf("/"))}/*` : undefined;
  if (profile.selector !== expectedSelector || receipt.source.id !== profile.source.id ||
    profile.source.profileDigest !== adapterCallPricingProfileDigest({
      basis: profile.basis, currency: profile.currency,
      source: { kind: profile.source.kind, id: profile.source.id, asOf: profile.source.asOf },
      requestModel: profile.requestModel, selector: profile.selector, match: profile.match,
      ratesPerMTok: { input: profile.ratesPerMTok.input, output: profile.ratesPerMTok.output,
        cacheRead: profile.ratesPerMTok.cacheRead, cacheWrite: profile.ratesPerMTok.cacheWrite },
    })) return false;
  const charges = new Map(receipt.charges.map((charge) => [charge.bucket, charge]));
  const missing = new Map(receipt.missing.map((entry) => [entry.bucket, entry]));
  if (charges.size !== receipt.charges.length || missing.size !== receipt.missing.length ||
    AdapterCallPriceBuckets.some((bucket) => Number(charges.has(bucket)) + Number(missing.has(bucket)) !== 1)) return false;
  for (const charge of receipt.charges) {
    const rate = bucketRate(profile.ratesPerMTok, charge.bucket);
    if (charge.ratePerMTok !== rate || charge.tokens > 0 && rate === null ||
      charge.amount !== (rate === null ? "0" : multiplyCanonicalDecimalPerMillion(rate, charge.tokens))) return false;
  }
  return receipt.state === (missing.size === 0 ? "complete" : "partial") &&
    receipt.amount === addCanonicalDecimals(receipt.charges.map((charge) => charge.amount));
}

function bucketRate(rates: JudgePriceReceipt["pricing"]["ratesPerMTok"], bucket: (typeof AdapterCallPriceBuckets)[number]): string | null {
  switch (bucket) {
    case "input": return rates.input;
    case "output": return rates.output;
    case "cache-read": return rates.cacheRead;
    case "cache-write": return rates.cacheWrite;
  }
}
function bucketTokens(call: JudgeUsageCall, bucket: (typeof AdapterCallPriceBuckets)[number]): number | null {
  switch (bucket) {
    case "input": return call.inputTokens;
    case "output": return call.outputTokens;
    case "cache-read": return call.cacheReadTokens;
    case "cache-write": return call.cacheWriteTokens;
  }
}

export function validateJudgeUsageAttachment(value: JudgeUsageAttachment): readonly RecordAttachmentIssue[] {
  const issue = (path: string[]) => [recordAttachmentIssue("record-attachment-schema-invalid", path)];
  if (value.calls.length > JudgeUsageLimits.maximumCalls) return issue(["calls"]);
  const calls = new Map<string, JudgeUsageCall>();
  const entries = new Map<number, string>();
  const entryIds = new Map<string, number>();
  const transmissions = new Map<string, { readonly operation: JudgeUsageCall["operation"]; readonly model: string; readonly provider: string; readonly ordinals: Set<number> }>();
  for (const call of value.calls) {
    if (!validCall(call) || calls.has(call.callId) ||
      entries.has(call.entryIndex) && entries.get(call.entryIndex) !== call.entryId ||
      entryIds.has(call.entryId) && entryIds.get(call.entryId) !== call.entryIndex) return issue(["calls", "callId"]);
    calls.set(call.callId, call);
    entries.set(call.entryIndex, call.entryId);
    entryIds.set(call.entryId, call.entryIndex);
    const key = `${call.entryIndex}:${call.logicalOrdinal}`;
    let logical = transmissions.get(key);
    if (logical === undefined) {
      logical = { operation: call.operation, model: call.requestModel, provider: call.transportProvider, ordinals: new Set() };
      transmissions.set(key, logical);
    }
    if (logical.operation !== call.operation || logical.model !== call.requestModel || logical.provider !== call.transportProvider) return issue(["calls", "logicalOrdinal"]);
    logical.ordinals.add(call.transmissionOrdinal);
  }
  for (const logical of transmissions.values()) {
    for (let ordinal = 1; ordinal <= logical.ordinals.size; ordinal++) {
      if (!logical.ordinals.has(ordinal)) return issue(["calls", "transmissionOrdinal"]);
    }
  }
  const seen = new Set<string>();
  for (const receipt of value.priceReceipts) {
    const call = calls.get(receipt.callId);
    if (call === undefined || seen.has(receipt.callId) || call.cost !== null ||
      receipt.pricing.requestModel !== call.requestModel || !validPriceReceipt(receipt)) return issue(["priceReceipts", "callId"]);
    seen.add(receipt.callId);
    const charges = new Map(receipt.charges.map((charge) => [charge.bucket, charge]));
    const missing = new Map(receipt.missing.map((entry) => [entry.bucket, entry]));
    for (const bucket of AdapterCallPriceBuckets) {
      const tokens = bucketTokens(call, bucket);
      const rate = bucketRate(receipt.pricing.ratesPerMTok, bucket);
      const charge = charges.get(bucket);
      if (tokens === null ? charge !== undefined || missing.get(bucket)?.reason !== "tokens-unknown"
        : tokens === 0 || rate !== null ? charge?.tokens !== tokens
        : charge !== undefined || missing.get(bucket)?.reason !== "rate-unknown") return issue(["priceReceipts", "charges"]);
    }
  }
  return [];
}
