// report 聚合(report/aggregate.ts)与 view 实验列表(view/app/lib/rows.ts)共用的聚合小工具。
// 实验标签推导、token/成本求和、verdict 排序各只有一份 —— 否则同一个实验在终端和网页上
// 会显示成两个名字 / 两组数。保持环境无关(纯函数,只 type import)。

import type { Usage } from "../o11y/types.ts";
import type { EvalResult, ExperimentRunInfo } from "../runner/types.ts";
import type { Verdict } from "./types.ts";

/** 明细行排序:失败最靠前(failed > errored > skipped > passed 的紧急程度)。 */
export const VERDICT_ORDER: globalThis.Record<Verdict, number> = {
  failed: 0,
  errored: 1,
  skipped: 2,
  passed: 3,
};

export function totalTokens(items: Array<Usage | undefined>): number {
  return items.reduce((n, u) => n + (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0), 0);
}

/** 求和,但「全都没报」时返回 undefined(区别于真 0 成本)。 */
export function sumMaybe(items: Array<number | undefined>): number | undefined {
  const known = items.filter((n): n is number => n !== undefined);
  return known.length ? known.reduce((sum, n) => sum + n, 0) : undefined;
}

export function avg(items: number[]): number {
  return items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0;
}

/** 实验 id 的展示名:取路径最后一段(exp 分组用目录表达)。 */
export function displayExperimentName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split("/").filter(Boolean).at(-1) ?? id;
}

/**
 * 实验 id 的组推导:去掉末段的目录前缀("compare/bub-low" → "compare");
 * 无 "/" 的顶层实验不属于任何组,返回 undefined。view 实验列表分组与自定义报告
 * 的分组用同一份,两边的「组」永远指同一个东西。
 */
export function experimentGroupOf(experimentId: string): string | undefined {
  if (!experimentId.includes("/")) return undefined;
  return experimentId.split("/").slice(0, -1).join("/");
}

/**
 * eval id 前缀过滤,同 CLI 位置参数语义(docs/feature/reports/show.md「打开与收窄」):
 * eval 位置参数是收窄过滤,按**裸前缀宽松匹配**——"algebra" 命中 "algebra"、"algebra/..."
 * 也命中 "algebra2",多命中正是它的用途(与 `--exp` 的按路径段匹配有意不同)。
 */
export function evalPrefixPredicate(evals?: string | string[]): (id: string) => boolean {
  if (evals === undefined) return () => true;
  const prefixes = Array.isArray(evals) ? evals : [evals];
  return (id) => prefixes.some((prefix) => id.startsWith(prefix));
}

/**
 * 实验选择器解析:`niceeval exp` 位置参数与 `--exp` 共用同一条规则(docs/feature/experiments/cli.md
 * 「实验选择器怎样解析」)。按序:①精确 id 优先,即使它同时是同目录内其它文件名的前缀;
 * ②目录段精确前缀(含更深层目录),选中该目录下全部实验;③以上都不命中且选择器形如
 * `目录/文件名前缀` 时,目录段精确匹配后按文件名段前缀选中一族配置——目录段永远精确,不跨目录
 * 误配,文件名段裸前缀,与 `evalPrefixPredicate` 同一条"共享前缀即家族"的逻辑。
 */
export function matchExperimentSelector(ids: readonly string[], selector: string): string[] {
  const exact = ids.find((id) => id === selector);
  if (exact !== undefined) return [exact];
  const dirMatches = ids.filter((id) => id.startsWith(selector + "/"));
  if (dirMatches.length > 0) return dirMatches;
  const lastSlash = selector.lastIndexOf("/");
  if (lastSlash === -1) return [];
  const dir = selector.slice(0, lastSlash);
  const namePrefix = selector.slice(lastSlash + 1);
  if (namePrefix === "") return [];
  return ids.filter((id) => id.startsWith(dir + "/") && id.slice(dir.length + 1).startsWith(namePrefix));
}

/**
 * 零命中时展示的可浏览路径清单(docs/feature/experiments/cli.md「零命中」):按 id 的顶层目录段
 * 去重、排序,带尾斜杠;没有目录段的顶层 experiment id 原样列出(它本身就是一个可选择的目标,
 * 不是一段路径)。这是运行选择的展示投影,不是报告分组。
 */
export function browsableExperimentPaths(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => (id.includes("/") ? `${id.split("/")[0]}/` : id)))].sort();
}

/** 无 experimentId 时的兜底标签。 */
export function fallbackExperimentLabel(result: {
  experimentId?: string;
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
}): string {
  if (result.experimentId) return displayExperimentName(result.experimentId) ?? result.experimentId;
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
}

export type { EvalResult };
