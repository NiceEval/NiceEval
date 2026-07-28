// 价格表兜底估算:agent 没带回网关实测成本时,用 token 用量 × vendored 单价估一个。
// 数据来自 src/o11y/prices.json(models.dev,见 scripts/sync-prices.ts);per-1M USD。
// 用户可在 `defineConfig({ pricing })` 里覆盖 / 补充(见 Observability · 用量与成本),
// 精确 model key 和 `provider/*` 通配都查用户表在先,查不到才落回内置快照。
//
// 与 types.ts 的约定一致:usage.costUSD(实测)优先,这里只在缺实测时兜底,
// 查不到价就返回 undefined —— 显示 "—" 而不是骗人的 $0。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PriceOverride, Usage } from "../types.ts";

interface Price {
  in: number;
  out: number;
  cacheRead?: number;
  cacheWrite?: number;
}

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
function lookupOverride(model: string, overrides: globalThis.Record<string, PriceOverride> | undefined): Price | undefined {
  if (!overrides) return undefined;
  if (overrides[model]) return toPrice(overrides[model]);
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined;
  if (provider && overrides[`${provider}/*`]) return toPrice(overrides[`${provider}/*`]);
  return undefined;
}

/**
 * 把五花八门的 model 标识归一到价格表的 key:精确命中优先,再退而去掉 provider 前缀
 * (`anthropic/claude-…` → `claude-…`)和末尾日期版本(`…-4-5-20251001` → `…-4-5`)。
 */
function lookupBuiltin(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model];
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  if (PRICES[bare]) return PRICES[bare];
  const undated = bare.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (PRICES[undated]) return PRICES[undated];
  return undefined;
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
  if (!model) return undefined;
  const p = lookupOverride(model, overrides) ?? lookupBuiltin(model);
  if (!p) return undefined;
  const bucket = (tokens: number | undefined, price: number | undefined, fallback: number): number =>
    tokens ? tokens * (price ?? fallback) : 0;
  const usd =
    (bucket(usage.inputTokens, p.in, p.in) +
      bucket(usage.outputTokens, p.out, p.out) +
      bucket(usage.cacheReadTokens, p.cacheRead, p.in) +
      bucket(usage.cacheCreationTokens, p.cacheWrite, p.in)) /
    1e6;
  return usd > 0 ? usd : undefined;
}
