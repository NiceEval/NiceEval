// defineMetric 与内置指标。
//
// null ≠ 0:null = 此 attempt 测不了这个指标(不进聚合);0 = 测了,结果是零(照常进)。
// 哪个 verdict 落哪边必须显式表态,内置指标按 docs/feature/reports/library.md「内置指标」的表格。
// 三个通过率指标把「Agent 答错」与「基建没跑起来」拆开,不互相伪装:
//
//   指标(name)                                    skipped  errored          failed  passed        better
//   taskPassRate(task-pass-rate)                   null     null             0       1             higher
//   executionReliability(execution-reliability)    null     0                1       1             higher
//   endToEndPassRate(end-to-end-pass-rate)         null     0                0       1             higher
//   examScore(exam-score)                          null     0                0       soft 均分      higher
//   totalScore(total-score)                        null     null             Σpoints Σpoints       higher(通过制 eval 恒 null,不参与聚合)
//   durationMs(duration)                           null     实测             实测     实测          lower
//   tokens(tokens)                                 null     实测;无 usage→null 同左   同左          lower
//   costUSD(cost)                                  null     同上             同左     同左          lower
//   assistantTurns(assistant-turns)                null     实测;o11y 缺失→null 同左  同左          lower
//   repeatedFailedCommands(repeated-failed-commands) null   实测;o11y 缺失→null 同左  同左          lower
//
// bounds(自然边界,驱动图轴呼吸边距的钳制,见 docs/feature/reports/library/metric-views.md
// 「图轴值域」):三个通过率指标与 examScore 是 { min: 0, max: 1 };其余七个(totalScore、
// durationMs、tokens、costUSD、assistantTurns、repeatedFailedCommands)是 { min: 0 }。
//
// 两档指标(docs/feature/reports/library/metrics.md「内置指标」):以上除 assistantTurns 与
// repeatedFailedCommands 外全部只读 attempt.result 的瘦身字段——任何 producer、任何
// copySnapshots artifacts 选择都算得出,内置报告 ExperimentComparison 只用这一档。
// 后两个读 attempt.o11y()(懒加载 artifact),发布时若 o11y 没随行就诚实渲染缺数据「—」,
// 不算 0——报告作者自己摆时心里要有这根弦,内置报告不用它们。

import type { EvalResult } from "../../types.ts";
import type { Metric } from "./types.ts";

/**
 * 定义一个指标。内置指标与自定义指标是同一个类型,没有特权;
 * 校验只管「能进计算」的最低要求,聚合语义见 docs/feature/reports/architecture.md「指标聚合不变量」。
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

/**
 * 条件答题质量:passed = 1,failed = 0,errored 记 null 不进分母。
 * 这是「已形成可信判定」条件下的诊断指标,不能简称默认通过率
 * (docs/feature/reports/library.md「内置指标」)。
 */
export const taskPassRate = defineMetric({
  name: "task-pass-rate",
  label: { en: "Task pass rate", "zh-CN": "可判定任务通过率" },
  description: "Conditional task quality among attempts that formed a trustworthy verdict: passed = 1, failed = 0; errored is null.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    switch (a.result.verdict) {
      case "passed":
        return 1;
      case "failed":
        return 0;
      default:
        // errored = 没形成可信判定 → null 不进这个条件指标;skipped 同为 null。
        return null;
    }
  },
});

/** 执行可靠性:跑到可判定(passed / failed)= 1,errored = 0;skipped → null。 */
export const executionReliability = defineMetric({
  name: "execution-reliability",
  label: { en: "Execution reliability", "zh-CN": "执行可靠性" },
  description: "Execution reliability: reached a trustworthy verdict (passed / failed) = 1, errored = 0.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    switch (a.result.verdict) {
      case "passed":
      case "failed":
        return 1;
      case "errored":
        return 0;
      default:
        return null; // skipped
    }
  },
});

/**
 * 端到端合成:passed = 1,failed / errored = 0;哪边拖累用
 * taskPassRate / executionReliability 拆开看。
 */
export const endToEndPassRate = defineMetric({
  name: "end-to-end-pass-rate",
  label: { en: "Pass rate", "zh-CN": "通过率" },
  description: "End-to-end composite: passed = 1, failed / errored = 0. Split blame with taskPassRate and executionReliability.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value: (a) =>
    a.result.verdict === "skipped" ? null : a.result.verdict === "passed" ? 1 : 0,
});

export const examScore = defineMetric({
  name: "exam-score",
  label: { en: "Exam score", "zh-CN": "考试得分" },
  description: "Per-eval score: gates decide pass, soft assertions grade quality.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    const { verdict, assertions } = a.result;
    if (verdict === "skipped") return null;
    // 先按 verdict 分派,再看断言:errored 的断言是空数组,「gate 全过才得分」的
    // 字面实现会让条件空真成立、崩溃反而得满分 —— 交白卷是 0 分,不是缺数据,更不是满分。
    // failed 同理得 0:--strict 下被翻成 failed 的哪怕 soft 分不低也是 0(报告不重新判卷)。
    if (verdict !== "passed") return 0;
    // unavailable 没有分数:不计入均分分母(评不了 ≠ 0 分;非 optional 的 unavailable
    // 早已把 verdict 拖成 errored,走不到这个分支)。带 points 的也排除:计分制的得分点
    // 已经在分数面被读过一次,再进质量分就是同一条证据被读两遍(docs/feature/experiments/
    // score-points.md「折叠树」——质量分按「soft 且无 points」取子集)。
    const soft = assertions.filter(
      (x) => x.severity === "soft" && x.outcome !== "unavailable" && x.points === undefined,
    );
    if (soft.length === 0) return 1;
    return soft.reduce((sum, x) => sum + (x.outcome === "unavailable" ? 0 : x.score), 0) / soft.length;
  },
});

/**
 * 计分制(`defineScoreEval`)eval 的挣分:`assertions[].points` 之和加 `scoreEntries[].points`
 * 之和——纯累加,不声明满分(docs/feature/experiments/score-points.md「计分制:叠加给分,
 * 没有上限声明」)。errored 记 null(基础设施得 null,不折成 0);skipped 同为 null。通过制
 * (`scoring !== "points"`,含省略即 "pass")eval 没有分数面,同样返回 null——这样跨题型的
 * Scope 里对 totalScore 求 acrossEvals 和时,通过制 eval 天然不贡献、也不拉低分母(它们不落
 * 进这个指标的样本)。`runs > 1` 时同一 eval 的多个 attempt 取均值(perEval mean,与文档「eval
 * 得分取各 attempt 的均值」一致);跨 eval 用 sum(acrossEvals sum,对应「总分 = Σ 各 eval 挣分」)。
 */
export const totalScore = defineMetric({
  name: "total-score",
  label: { en: "Total score", "zh-CN": "总分" },
  description: "Points-scoring eval's earned points: sum of assertions[].points + scoreEntries[].points. Not applicable (null) to pass-scoring evals.",
  better: "higher",
  bounds: { min: 0 },
  value(a) {
    if (a.result.scoring !== "points") return null;
    if (a.result.verdict === "errored" || a.result.verdict === "skipped") return null;
    let total = 0;
    for (const assertion of a.result.assertions) {
      if (assertion.outcome !== "unavailable" && typeof assertion.points === "number") total += assertion.points;
    }
    for (const entry of a.result.scoreEntries ?? []) total += entry.points;
    return total;
  },
  aggregate: { perEval: "mean", acrossEvals: "sum" },
});

export const durationMs = defineMetric({
  name: "duration",
  label: { en: "Duration", "zh-CN": "平均耗时" },
  description: "Wall-clock duration of the attempt.",
  better: "lower",
  unit: "ms",
  bounds: { min: 0 },
  value: (a) => (a.result.verdict === "skipped" ? null : a.result.durationMs),
});

export const tokens = defineMetric({
  name: "tokens",
  label: { en: "Tokens", "zh-CN": "Tokens" },
  description: "Input + output tokens (cache reads/writes excluded).",
  better: "lower",
  unit: "tokens",
  bounds: { min: 0 },
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
  label: { en: "Cost", "zh-CN": "成本" },
  description: "USD cost per attempt (gateway-measured beats estimated).",
  better: "lower",
  unit: "$",
  bounds: { min: 0 },
  value: (a) => (a.result.verdict === "skipped" ? null : attemptCostUSD(a.result)),
});

/**
 * 读 artifact(o11y,懒加载)的内置指标之一——其余只读瘦身字段。
 * 发布时若该 attempt 没带 o11y(如 copySnapshots 的 artifacts 选项漏了它),
 * value 如实返回 null,渲染成「—」,不冒充 0。名字带限定词:o11y 事件流中的 assistant
 * turn 数与 `t.send` 的 `s<session>/t<turn>` 轮次是两个计数。
 */
export const assistantTurns = defineMetric({
  name: "assistant-turns",
  label: { en: "Assistant turns", "zh-CN": "Assistant 轮次" },
  description: "Assistant turns in the o11y event stream per attempt. Reads o11y — “—” if not published alongside this attempt.",
  better: "lower",
  unit: "turns",
  bounds: { min: 0 },
  async value(a) {
    if (a.result.verdict === "skipped") return null;
    const o11y = await a.o11y();
    return o11y?.totalTurns ?? null;
  },
});

/**
 * 同一 attempt 内同一条 shell 命令的重复失败数:每条命令失败 n 次(n > 1)记 n − 1,求和。
 * 成功执行与只失败一次的命令不计。回答 agent 是否在反复撞同一个已知失败的命令。
 * 读 o11y.json;skipped 与缺 o11y 返回 null(docs/feature/reports/library/metrics.md「内置指标」)。
 */
export const repeatedFailedCommands = defineMetric({
  name: "repeated-failed-commands",
  label: { en: "Repeated failed commands", "zh-CN": "重复失败命令" },
  description: "Per attempt: for each shell command failing n > 1 times, count n − 1, summed. Reads o11y — “—” if not published alongside this attempt.",
  better: "lower",
  unit: "cmds",
  bounds: { min: 0 },
  async value(a) {
    if (a.result.verdict === "skipped") return null;
    const o11y = await a.o11y();
    if (!o11y) return null;
    const failures = new Map<string, number>();
    for (const entry of o11y.shellCommands) {
      const failed = entry.success === false || (entry.success === undefined && entry.exitCode !== undefined && entry.exitCode !== 0);
      if (!failed) continue;
      failures.set(entry.command, (failures.get(entry.command) ?? 0) + 1);
    }
    let repeated = 0;
    for (const n of failures.values()) if (n > 1) repeated += n - 1;
    return repeated;
  },
});
