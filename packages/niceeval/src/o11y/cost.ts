// 价格表估算:token 用量 × vendored 单价,与 observed 成本无关。
// 数据来自 src/o11y/prices.json(models.dev + LiteLLM,见 scripts/sync-prices.mjs);per-1M USD。
// 用户可在 `defineConfig({ pricing })` 里覆盖 / 补充(见 Observability · 用量与成本),
// 精确 model key 和 `provider/*` 通配都查用户表在先,查不到才落回内置快照。
//
// estimateCost 是 EvalResult.estimatedCostUSD 的唯一来源,永远独立计算:即使
// usage.costUSD(网关/adapter 显式回报的 observed 成本)存在也照常按 model + usage +
// pricing 估算,两者互不覆盖、互不兜底——observed 只留在 result.usage.costUSD,
// estimated 只在 result.estimatedCostUSD。查不到价就返回 undefined —— 显示 "—"
// 而不是骗人的 $0。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PriceOverride, Usage } from "../types.ts";

interface Price {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PricingEstimateCharge {
  readonly bucket: "input" | "output" | "cache-read" | "cache-write";
  readonly tokens: number;
  readonly rateUSDPerMTok: number;
  readonly amountUSD: number;
}

export interface PricingEstimateReceipt {
  readonly kind: "pricing-estimate";
  readonly model: string;
  readonly priceSource:
    | { readonly kind: "configured-override"; readonly selector: string }
    | { readonly kind: "builtin"; readonly selector: string };
  readonly charges: readonly PricingEstimateCharge[];
  readonly amountUSD: number;
}

export type PricingEstimateUnavailableReason =
  | "model-not-recorded"
  | "price-source-not-found"
  | "pricing-input-invalid"
  | "usage-not-recorded";

export type PricingEstimateResult =
  | { readonly state: "available"; readonly receipt: PricingEstimateReceipt }
  | { readonly state: "unavailable"; readonly reason: PricingEstimateUnavailableReason };

const PRICES: globalThis.Record<string, Price> = (() => {
  try {
    const raw = readFileSync(fileURLToPath(new URL("./prices.json", import.meta.url)), "utf-8");
    return (JSON.parse(raw) as { prices?: globalThis.Record<string, Price> }).prices ?? {};
  } catch {
    return {};
  }
})();

function toPrice(o: PriceOverride): Price {
  return { in: o.inputPerMTok, out: o.outputPerMTok, cacheRead: o.cacheReadPerMTok, cacheWrite: o.cacheWritePerMTok };
}

/**
 * 用户覆盖表:精确 model key 优先,再退而查 `provider/*` 通配
 *(`anthropic/*` 命中 `anthropic/claude-…`,批量覆盖自托管 / 网关折扣场景)。
 */
function lookupOverride(
  model: string,
  overrides: globalThis.Record<string, PriceOverride> | undefined,
): { readonly price: Price; readonly selector: string } | undefined {
  if (!overrides) return undefined;
  if (overrides[model]) return Object.freeze({ price: toPrice(overrides[model]), selector: model });
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined;
  const wildcard = provider === undefined ? undefined : `${provider}/*`;
  if (wildcard !== undefined && overrides[wildcard]) {
    return Object.freeze({ price: toPrice(overrides[wildcard]), selector: wildcard });
  }
  return undefined;
}

/**
 * 把五花八门的 model 标识归一到价格表的 key:精确命中优先,再退而去掉 provider 前缀
 * (`anthropic/claude-…` → `claude-…`)和末尾日期版本(`…-4-5-20251001` → `…-4-5`)。
 */
function lookupBuiltin(model: string): { readonly price: Price; readonly selector: string } | undefined {
  if (PRICES[model]) return Object.freeze({ price: PRICES[model], selector: model });
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  if (PRICES[bare]) return Object.freeze({ price: PRICES[bare], selector: bare });
  const undated = bare.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (PRICES[undated]) return Object.freeze({ price: PRICES[undated], selector: undated });
  return undefined;
}

function pricingEstimateCharge(
  bucket: PricingEstimateCharge["bucket"],
  tokens: number | undefined,
  rateUSDPerMTok: number,
): PricingEstimateCharge | undefined {
  if (tokens === undefined) return undefined;
  const amountUSD = tokens * rateUSDPerMTok / 1e6;
  return Object.freeze({ bucket, tokens, rateUSDPerMTok, amountUSD });
}

/**
 * Produces the bounded provenance receipt consumed by maxCost. The selected
 * model key and effective fallback rates are sealed here so readers never
 * need the mutable pricing catalog.
 */
export function pricingEstimate(
  model: string | undefined,
  usage: Usage,
  overrides?: globalThis.Record<string, PriceOverride>,
): PricingEstimateResult {
  if (!model) return Object.freeze({ state: "unavailable", reason: "model-not-recorded" });
  const override = lookupOverride(model, overrides);
  const selected = override ?? lookupBuiltin(model);
  if (selected === undefined) {
    return Object.freeze({ state: "unavailable", reason: "price-source-not-found" });
  }
  const p = selected.price;
  const buckets = [
    ["input", usage.inputTokens, p.in],
    ["output", usage.outputTokens, p.out],
    ["cache-read", usage.cacheReadTokens, p.cacheRead ?? p.in],
    ["cache-write", usage.cacheCreationTokens, p.cacheWrite ?? p.in],
  ] as const;
  if (buckets.some(([, tokens, rate]) =>
    (tokens !== undefined && (!Number.isFinite(tokens) || tokens < 0)) ||
    !Number.isFinite(rate) || rate < 0
  )) return Object.freeze({ state: "unavailable", reason: "pricing-input-invalid" });
  const charges = buckets
    .map(([bucket, tokens, rate]) => pricingEstimateCharge(bucket, tokens, rate))
    .filter((charge): charge is PricingEstimateCharge => charge !== undefined);
  if (charges.length === 0) {
    return Object.freeze({ state: "unavailable", reason: "usage-not-recorded" });
  }
  const amountUSD = charges.reduce((sum, charge) => sum + charge.amountUSD, 0);
  if (!Number.isFinite(amountUSD) || amountUSD < 0) {
    return Object.freeze({ state: "unavailable", reason: "pricing-input-invalid" });
  }
  return Object.freeze({
    state: "available" as const,
    receipt: Object.freeze({
      kind: "pricing-estimate" as const,
      model,
      priceSource: Object.freeze(override === undefined
        ? { kind: "builtin" as const, selector: selected.selector }
        : { kind: "configured-override" as const, selector: selected.selector }),
      charges: Object.freeze(charges),
      amountUSD,
    }),
  });
}

/**
 * 按 token 桶 × 单价估算一次运行的美元成本。逐桶相加成立的前提是 Usage 桶恒互斥
 * (inputTokens 不含 cache 命中,归一义务在 adapter,见 docs/feature/record/architecture.md#usage);
 * cache 桶缺专门单价时退回 input 价——宁可高估,不静默低估。
 * 无 model / 查不到价(用户表 + 内置快照都没有)→ undefined。
 */
export function estimateCost(
  model: string | undefined,
  usage: Usage,
  overrides?: globalThis.Record<string, PriceOverride>,
): number | undefined {
  const result = pricingEstimate(model, usage, overrides);
  return result.state === "available" ? result.receipt.amountUSD : undefined;
}
