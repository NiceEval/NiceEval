// 成本估算:用量 × 价格表。实测优先(usage.costUSD 来自网关)→ 用户覆盖 → 内置快照。
// 未知模型只报 token、不报 $(诚实降级),返回 undefined。价格是会过期的数据,
// 内置快照只为「零配置能用」,准确性靠用户在 config.pricing 覆盖。

import type { PriceEntry, Usage } from "../types.ts";

/** 内置价格快照(USD / 百万 token)。带版本意识,过期靠用户覆盖。 */
const BUILTIN_PRICING: Record<string, PriceEntry> = {
  "gpt-5.4": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5.4-mini": { inputPerMTok: 0.25, outputPerMTok: 2, cacheReadPerMTok: 0.025 },
  "gpt-5.3-codex": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5.2": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5.5": { inputPerMTok: 1.5, outputPerMTok: 12, cacheReadPerMTok: 0.15 },
  "anthropic/claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1 },
  "anthropic/claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
};

function lookup(
  model: string | undefined,
  userPricing: Record<string, PriceEntry> | undefined,
): PriceEntry | undefined {
  if (!model) return undefined;
  const tables = [userPricing, BUILTIN_PRICING];
  const base = model.includes("/") ? model.split("/").pop()! : model;
  for (const table of tables) {
    if (!table) continue;
    if (table[model]) return table[model];
    if (table[base]) return table[base];
    // 通配:my-selfhosted/*
    for (const [k, v] of Object.entries(table)) {
      if (k.endsWith("/*") && model.startsWith(k.slice(0, -1))) return v;
    }
  }
  return undefined;
}

export function estimateCost(
  usage: Usage,
  model: string | undefined,
  userPricing?: Record<string, PriceEntry>,
): number | undefined {
  // 网关实测最高优先
  if (usage.costUSD !== undefined) return usage.costUSD;
  const price = lookup(model, userPricing);
  if (!price) return undefined;
  const inputCost = ((usage.inputTokens - (usage.cacheReadTokens ?? 0)) / 1e6) * price.inputPerMTok;
  const cacheCost = ((usage.cacheReadTokens ?? 0) / 1e6) * (price.cacheReadPerMTok ?? price.inputPerMTok);
  const outputCost = (usage.outputTokens / 1e6) * price.outputPerMTok;
  return Math.max(0, inputCost) + cacheCost + outputCost;
}
