// defineMetric 与内置指标。
//
// null ≠ 0:null = 此 attempt 测不了这个指标(不进聚合);0 = 测了,结果是零(照常进)。
// 哪个 verdict 落哪边必须显式表态,内置指标按 docs/reports.md 的表格:
//
//   指标(name)             skipped  errored          failed  passed        better
//   passRate(pass-rate)     null     0                0       1             higher
//   examScore(exam-score)   null     0                0       soft 均分      higher
//   durationMs(duration)    null     实测             实测     实测          lower
//   tokens(tokens)          null     实测;无 usage→null 同左   同左          lower
//   costUSD(cost)           null     同上             同左     同左          lower

import type { EvalResult } from "../types.ts";
import type { Metric } from "./types.ts";

/**
 * 定义一个指标。内置指标与自定义指标是同一个类型,没有特权;
 * 校验只管「能进计算」的最低要求,聚合语义见 docs/reports.md。
 * name 是 const 泛型:产物的 name 保持字面量,`row.cells[metric.name]` 才有编译期列键。
 */
export function defineMetric<const Name extends string>(def: Metric<Name>): Metric<Name> {
  if (typeof def.name !== "string" || def.name.length === 0) {
    throw new Error("defineMetric: metric name must be a non-empty string.");
  }
  if (typeof def.value !== "function") {
    throw new Error(`defineMetric: metric "${def.name}" must provide a value(attempt) function.`);
  }
  return { ...def };
}

/** 单 attempt 成本:网关实测(usage.costUSD)优先于价格表估算(estimatedCostUSD);都缺 → null,不编 0。 */
export function attemptCostUSD(result: EvalResult): number | null {
  return result.usage?.costUSD ?? result.estimatedCostUSD ?? null;
}

export const passRate = defineMetric({
  name: "pass-rate",
  label: "Pass rate",
  description: "Share of evals that passed (skipped attempts excluded).",
  better: "higher",
  unit: "%",
  value: (a) =>
    a.result.verdict === "skipped" ? null : a.result.verdict === "passed" ? 1 : 0,
});

export const examScore = defineMetric({
  name: "exam-score",
  label: "Exam score",
  description: "Per-eval score: gates decide pass, soft assertions grade quality.",
  better: "higher",
  unit: "%",
  value(a) {
    const { verdict, assertions } = a.result;
    if (verdict === "skipped") return null;
    // 先按 verdict 分派,再看断言:errored 的断言是空数组,「gate 全过才得分」的
    // 字面实现会让条件空真成立、崩溃反而得满分 —— 交白卷是 0 分,不是缺数据,更不是满分。
    // failed 同理得 0:--strict 下被翻成 failed 的哪怕 soft 分不低也是 0(报告不重新判卷)。
    if (verdict !== "passed") return 0;
    const soft = assertions.filter((x) => x.severity === "soft");
    if (soft.length === 0) return 1;
    return soft.reduce((sum, x) => sum + x.score, 0) / soft.length;
  },
});

export const durationMs = defineMetric({
  name: "duration",
  label: "Duration",
  description: "Wall-clock duration of the attempt.",
  better: "lower",
  unit: "ms",
  value: (a) => (a.result.verdict === "skipped" ? null : a.result.durationMs),
});

export const tokens = defineMetric({
  name: "tokens",
  label: "Tokens",
  description: "Input + output tokens (cache reads/writes excluded).",
  better: "lower",
  unit: "tokens",
  value(a) {
    if (a.result.verdict === "skipped") return null;
    const usage = a.result.usage;
    if (!usage) return null;
    // 只加 input + output:缓存读写量大但便宜,计进去会把缓存热的 agent 画成 token 大户;
    // 花钱多少本来就有 costUSD 负责。
    return usage.inputTokens + usage.outputTokens;
  },
});

export const costUSD = defineMetric({
  name: "cost",
  label: "Cost",
  description: "USD cost per attempt (gateway-measured beats estimated).",
  better: "lower",
  unit: "$",
  value: (a) => (a.result.verdict === "skipped" ? null : attemptCostUSD(a.result)),
});
