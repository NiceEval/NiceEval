import { Predicate, Result, Schema } from "effect";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { RecordSha256 } from "../record/definition/digest.ts";
import { FiniteNonNegativeNumberSchema, NonNegativeSafeIntegerSchema } from "../record/family/common.ts";
import { CanonicalDecimalSchema, CurrencyCodeSchema } from "../record/family/source-receipt/codec.ts";
import { canonicalDecimalFromNumber } from "../record/family/adapter-usage/pricing.ts";
import { JudgeUsageLimits, JudgeUsageModelSchema, type JudgeUsageCall } from "../record/family/judge-usage/schema.ts";

type NormalizedResponse = Pick<JudgeUsageCall,
  "provider" | "model" | "inputTokens" | "inputTotalTokens" | "outputTokens" |
  "cacheReadTokens" | "cacheWriteTokens" | "cost" | "receipt"
>;
type Field = JudgeUsageCall["receipt"]["fields"][number];
const ProviderSchema = JudgeUsageModelSchema.check(Schema.makeFilter((value) => new TextEncoder().encode(value).byteLength <= 256));
const JsonResponseSchema = Schema.fromJsonString(Schema.Unknown);

function unavailable(reason: JudgeUsageCall["receipt"]["reason"], responseDigest: string | null): NormalizedResponse {
  return Object.freeze({
    provider: null, model: null, inputTokens: null, inputTotalTokens: null, outputTokens: null,
    cacheReadTokens: null, cacheWriteTokens: null, cost: null,
    receipt: Object.freeze({ state: "unavailable", reason, responseDigest, fields: Object.freeze([]) }),
  });
}

/** Retains only protocol facts, independently of status and QA/body interpretation. */
export function normalizeJudgeUsageResponse(
  transportProvider: JudgeUsageCall["transportProvider"],
  body: string,
): NormalizedResponse {
  const bytes = new TextEncoder().encode(body);
  if (body.length === 0) return unavailable("response-unavailable", null);
  const responseDigest = `sha256:${new RecordSha256().update(bytes).digestHex()}`;
  const decoded = Schema.decodeUnknownResult(JsonResponseSchema)(body);
  if (Result.isFailure(decoded)) return unavailable("invalid-json", responseDigest);
  const root = decoded.success;
  if (!Predicate.isObject(root) || Array.isArray(root)) return unavailable("invalid-usage", responseDigest);
  const fields: Field[] = [];
  let invalidUsage = root.usage !== undefined && (!Predicate.isObject(root.usage) || Array.isArray(root.usage));
  let modelTooLarge = false;
  function read(path: Field["path"]): unknown {
    let value: unknown = root;
    for (const key of path.split(".")) {
      if (!Predicate.isObject(value) || Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
      value = value[key];
    }
    return value;
  }
  function scalar<A>(path: Field["path"], schema: Schema.Codec<A, string | number>): A | null {
    const raw = read(path);
    if (raw === undefined) return null;
    const value = Schema.decodeUnknownResult(schema, RecordExactParseOptions)(raw);
    if (Result.isFailure(value)) {
      if (path === "model" && typeof raw === "string" && new TextEncoder().encode(raw).byteLength > JudgeUsageLimits.maximumModelBytes) modelTooLarge = true;
      else invalidUsage = true;
      return null;
    }
    // Schemas above accept only string/number encodings, so arbitrary JSON never enters a receipt.
    if (typeof raw === "string" || typeof raw === "number") fields.push({ path, value: raw === 0 ? 0 : raw });
    return value.success;
  }
  const model = scalar("model", JudgeUsageModelSchema);
  const provider = transportProvider === "openrouter" ? scalar("provider", ProviderSchema) : null;
  const inputPath = transportProvider === "typesafe" ? "usage.input_tokens" : "usage.prompt_tokens";
  const outputPath = transportProvider === "typesafe" ? "usage.output_tokens" : "usage.completion_tokens";
  let inputTotalTokens = scalar(inputPath, NonNegativeSafeIntegerSchema);
  let outputTokens = scalar(outputPath, NonNegativeSafeIntegerSchema);
  const totalTokens = scalar("usage.total_tokens", NonNegativeSafeIntegerSchema);
  let cacheReadTokens = transportProvider === "typesafe" ? null
    : scalar("usage.prompt_tokens_details.cached_tokens", NonNegativeSafeIntegerSchema);
  let cacheWriteTokens = transportProvider === "openrouter"
    ? scalar("usage.prompt_tokens_details.cache_write_tokens", NonNegativeSafeIntegerSchema) : null;
  let inputTokens: number | null = null;
  if (transportProvider !== "typesafe") {
    const details = read("usage.prompt_tokens_details.cached_tokens");
    const write = read("usage.prompt_tokens_details.cache_write_tokens");
    const usage = root.usage;
    const malformedDetails = Predicate.isObject(usage) && usage.prompt_tokens_details !== undefined &&
      (!Predicate.isObject(usage.prompt_tokens_details) || Array.isArray(usage.prompt_tokens_details));
    if (malformedDetails) invalidUsage = true;
    const invalidCache = malformedDetails || details !== undefined && cacheReadTokens === null ||
      transportProvider === "openrouter" && write !== undefined && cacheWriteTokens === null;
    const invalidZeroWrite = write !== undefined &&
      (!Schema.is(NonNegativeSafeIntegerSchema)(write) || write !== 0);
    const knownSum = (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
    if (!Number.isSafeInteger(knownSum) || inputTotalTokens !== null &&
      (knownSum > inputTotalTokens || inputTotalTokens === 0 && (invalidCache || invalidZeroWrite))) {
      invalidUsage = true;
      inputTotalTokens = cacheReadTokens = cacheWriteTokens = null;
    } else if (inputTotalTokens === 0 && !invalidCache) {
      // Non-negative sub-buckets of an explicitly zero total are independently zero.
      inputTokens = cacheReadTokens = cacheWriteTokens = 0;
    } else if (inputTotalTokens !== null && cacheReadTokens !== null && cacheWriteTokens !== null) {
      inputTokens = inputTotalTokens - cacheReadTokens - cacheWriteTokens;
    }
  }
  const invalidTotal = read("usage.total_tokens") !== undefined && totalTokens === null;
  if (invalidTotal || totalTokens !== null &&
    (inputTotalTokens !== null && inputTotalTokens > totalTokens || outputTokens !== null && outputTokens > totalTokens) ||
    inputTotalTokens !== null && outputTokens !== null &&
    (!Number.isSafeInteger(inputTotalTokens + outputTokens) || totalTokens !== null && totalTokens !== inputTotalTokens + outputTokens)) {
    invalidUsage = true;
    inputTokens = inputTotalTokens = outputTokens = cacheReadTokens = cacheWriteTokens = null;
  }
  let cost: JudgeUsageCall["cost"] = null;
  if (transportProvider === "openrouter") {
    const raw = read("usage.cost");
    if (raw !== undefined) {
      const amount = typeof raw === "number" && Schema.is(FiniteNonNegativeNumberSchema)(raw)
        ? canonicalDecimalFromNumber(raw) : raw;
      const parsed = Schema.decodeUnknownResult(CanonicalDecimalSchema)(amount);
      if (Result.isFailure(parsed)) invalidUsage = true;
      else {
        const currency = Schema.decodeUnknownSync(CurrencyCodeSchema)("USD");
        cost = Object.freeze({ amount: parsed.success, currency, source: Object.freeze({ kind: "reported", id: "openrouter.usage.cost" }) });
        if (typeof raw === "string" || typeof raw === "number") fields.push({ path: "usage.cost", value: raw === 0 ? 0 : raw });
      }
    }
  }
  fields.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const usageReported = fields.some((field) => field.path.startsWith("usage."));
  const reason = invalidUsage ? "invalid-usage" : modelTooLarge ? "response-model-too-large" : usageReported ? null : "usage-not-reported";
  return Object.freeze({
    provider, model, inputTokens, inputTotalTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost,
    receipt: Object.freeze({
      state: fields.length > 0 ? "available" : "unavailable", reason, responseDigest,
      fields: Object.freeze(fields.map((field) => Object.freeze(field))),
    }),
  });
}
