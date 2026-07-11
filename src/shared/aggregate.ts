// CLI 表格(runner/reporters/table.ts)与 view 榜单(view/aggregate.ts)共用的聚合小工具。
// 实验标签推导、token/成本求和、verdict 排序各只有一份 —— 否则同一个实验在终端和网页上
// 会显示成两个名字 / 两组数。保持环境无关(纯函数,只 type import)。

import type { Usage } from "../o11y/types.ts";
import type { EvalResult, ExperimentRunInfo } from "../runner/types.ts";
import type { Verdict } from "../scoring/types.ts";

/** 明细行排序:失败最靠前(failed > errored > skipped > passed 的紧急程度)。 */
export const VERDICT_ORDER: Record<Verdict, number> = {
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

/** 无 experimentId 时的兜底标签。 */
export function fallbackExperimentLabel(result: {
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
}): string {
  if (result.experiment?.id) return displayExperimentName(result.experiment.id) ?? result.experiment.id;
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
}

export type { EvalResult };
