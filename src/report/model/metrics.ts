// 内置读数（AttemptMetric 字面量）。
//
// null ≠ 0:null = 此 attempt 测不了这个指标(不进聚合);0 = 测了,结果是零(照常进)。
// 哪个 verdict 落哪边必须显式表态,内置指标按 docs/feature/reports/library.md「内置指标」的表格。
// 三个通过率指标把「Agent 答错」与「基建没跑起来」拆开,不互相伪装:
//
//   指标(name)                                    skipped  errored          failed  passed        better
//   taskPassRate(task-pass-rate)                   null     null             0       1             higher
//   executionReliability(execution-reliability)    null     0                1       1             higher
//   passRate(pass-rate)                            null     0                0       1             higher
//   examScore(exam-score)                          null     有分数则均分，否则 null            higher
//   totalScore(total-score)                        null     null             Σpoints Σpoints       higher(通过制 eval 恒 null,不参与聚合)
//   durationMs(duration)                           null     实测;timeout→null 同左   实测     实测          lower
//   tokens(tokens)                                 null     实测;无 usage→null 同左   同左          lower
//   costUSD(cost)                                  null     同上             同左     同左          lower
//   assistantTurns(assistant-turns)                null     实测;o11y 缺失→null 同左  同左          lower
//   repeatedFailedCommands(repeated-failed-commands) null   实测;o11y 缺失→null 同左  同左          lower
//
// bounds(自然边界,驱动图轴呼吸边距的钳制,见 docs/feature/reports/components/charts/README.md
// 「值域」):三个通过率指标与 examScore 是 { min: 0, max: 1 };其余七个(totalScore、
// durationMs、tokens、costUSD、assistantTurns、repeatedFailedCommands)是 { min: 0 }。
//
// 两档指标(docs/feature/reports/library/measures.md「内置指标」):以上除 assistantTurns 与
// repeatedFailedCommands 外全部只读 attempt.result 的瘦身字段——任何 producer、任何
// publish artifacts 选择都算得出,内置 SampleOverview 只用这一档。
// 后两个读 attempt.o11y()(懒加载 artifact),发布时若 o11y 没随行就诚实渲染缺数据「—」,
// 不算 0——报告作者自己摆时心里要有这根弦,内置报告不用它们。

import type { EvalResult } from "../../types.ts";
import { factRecordOf, scoreOutcomeOf, verdictForTerminal } from "../../record/fact-record.ts";
import type { AttemptMetric } from "./types.ts";

/** 内部：校验 AttemptMetric 字面量；不对外导出。 */
function attemptMetric<const Name extends string>(def: AttemptMetric<Name>): AttemptMetric<Name> {
  if (typeof def.name !== "string" || def.name.length === 0) {
    throw new Error(`attemptMetric: name must be a non-empty string.`);
  }
  if (typeof def.value !== "function") {
    throw new Error(`attemptMetric "${def.name}" must provide a value(attempt) function.`);
  }
  return def;
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
export const taskPassRate = attemptMetric({
  name: "task-pass-rate",
  label: { en: "Task pass rate", "zh-CN": "可判定任务通过率" },
  description: "Conditional task quality among attempts that formed a trustworthy verdict: passed = 1, failed = 0; errored is null.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    switch (verdictForTerminal(a.result)) {
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
export const executionReliability = attemptMetric({
  name: "execution-reliability",
  label: { en: "Execution reliability", "zh-CN": "执行可靠性" },
  description: "Execution reliability: reached a trustworthy verdict (passed / failed) = 1, errored = 0.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    switch (verdictForTerminal(a.result)) {
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
export const passRate = attemptMetric({
  name: "passRate",
  label: { en: "Pass rate", "zh-CN": "通过率" },
  description: "End-to-end composite: passed = 1, failed / errored = 0. Split blame with taskPassRate and executionReliability.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value: (a) => {
    const verdict = verdictForTerminal(a.result);
    return verdict === "skipped" ? null : verdict === "passed" ? 1 : 0;
  },
});

export const examScore = attemptMetric({
  name: "exam-score",
  label: { en: "Exam score", "zh-CN": "考试得分" },
  description: "Per-eval score: consumed successful Score Facts without score uses are averaged once each.",
  better: "higher",
  unit: "%",
  bounds: { min: 0, max: 1 },
  value(a) {
    const fact = factRecordOf(a.result);
    if (fact === undefined) return null;
    const scoreUseFactIds = new Set(
      fact.factUses.flatMap((use) => use.useKind === "score" && use.input.kind === "fact" ? [use.input.factId] : []),
    );
    const consumedFactIds = new Set(
      fact.factUses.flatMap((use) => use.useKind === "verdict" ? [use.target.factId] : use.input.kind === "fact" ? [use.input.factId] : []),
    );
    const scores = fact.factResults.flatMap((item) =>
      item.factKind === "score" && item.outcome === "scored" && consumedFactIds.has(item.factId) && !scoreUseFactIds.has(item.factId)
        ? [item.normalizedScore]
        : [],
    );
    if (scores.length === 0) return null;
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  },
});

/**
 * 计分制 Attempt 只读 Fact score outcome 的 `creditedScore`：invalid 的 0 正常进入均值，
 * unavailable / errored / skipped 的 null 不进分母；earnedScore 永远只是诊断。通过制同样
 * 返回 null。每题对所有非 null Attempt 取均值，再跨题求和，因此不会产生 survivor bias。
 */
export const totalScore = attemptMetric({
  name: "total-score",
  label: { en: "Total score", "zh-CN": "总分" },
  description: "Score eval creditedScore: invalid contributes 0, unavailable/errored/skipped contribute null; pass evals are null.",
  better: "higher",
  bounds: { min: 0 },
  value(a) {
    return scoreOutcomeOf(a.result)?.creditedScore ?? null;
  },
  perEval: "mean",
  acrossEvals: "sum",
});

export const durationMs = attemptMetric({
  name: "duration",
  label: { en: "Duration", "zh-CN": "平均耗时" },
  description: "Wall-clock duration of the attempt. Timeout-truncated attempts (error.code = \"timeout\") return null: the timeout line is a right-censoring point, not an observed completion time.",
  better: "lower",
  unit: "ms",
  bounds: { min: 0 },
  value(a) {
    if (verdictForTerminal(a.result) === "skipped") return null;
    // 超时删失:线值不是「跑了这么久」,是「被砍在这里」——计入聚合会把截断当实测,
    // 排除又制造幸存者偏差(慢条件因为被截断反而显得快)。唯一诚实做法是 null,
    // 让 MetricValue 的 samples < total 把删失显式呈现出来(docs/feature/reports/library/measures.md「内置指标」)。
    if (verdictForTerminal(a.result) === "errored" && a.result.error?.code === "timeout") return null;
    return a.result.durationMs;
  },
});

export const tokens = attemptMetric({
  name: "tokens",
  label: { en: "Tokens", "zh-CN": "Tokens" },
  description: "Complete model traffic: input + cache read + cache creation + output tokens.",
  better: "lower",
  unit: "tokens",
  bounds: { min: 0 },
  value(a) {
    if (verdictForTerminal(a.result) === "skipped") return null;
    const usage = a.result.usage;
    // input/output 缺失(协议没提供)→ null:缺了主干桶,剩下缓存明细只是局部数据,
    // 拿它冒充完整流量比编 0 更误导(docs/feature/record/architecture.md#usage)。
    if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
    // 四个桶恒互斥(缓存命中已在归一阶段从 inputTokens 扣出),求和即完整模型流量;
    // 缓存桶是独立计价桶,agent 不上报时按 0,与 usage 审计面口径一致。
    return (
      usage.inputTokens +
      (usage.cacheReadTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      usage.outputTokens
    );
  },
});

export const costUSD = attemptMetric({
  name: "cost",
  label: { en: "Cost", "zh-CN": "成本" },
  description: "USD cost per attempt (gateway-measured beats estimated).",
  better: "lower",
  unit: "$",
  bounds: { min: 0 },
  value: (a) => (verdictForTerminal(a.result) === "skipped" ? null : attemptCostUSD(a.result)),
});

/**
 * 读 artifact(o11y,懒加载)的内置指标之一——其余只读瘦身字段。
 * 发布时若该 attempt 没带 o11y(如 publish 的 artifacts 选项漏了它),
 * value 如实返回 null,渲染成「—」,不冒充 0。名字带限定词:o11y 事件流中的 assistant
 * turn 数与 `t.send` 的 `turn<N>` / `session<K>/turn<N>` 轮次是两个计数。
 */
export const assistantTurns = attemptMetric({
  name: "assistant-turns",
  label: { en: "Assistant turns", "zh-CN": "Assistant 轮次" },
  description: "Assistant turns in the o11y event stream per attempt. Reads o11y — “—” if not published alongside this attempt.",
  better: "lower",
  unit: "turns",
  bounds: { min: 0 },
  async value(a) {
    if (verdictForTerminal(a.result) === "skipped") return null;
    const o11y = await a.o11y();
    return o11y?.totalTurns ?? null;
  },
});

/**
 * 同一 attempt 内同一条 shell 命令的重复失败数:每条命令失败 n 次(n > 1)记 n − 1,求和。
 * 成功执行与只失败一次的命令不计。回答 agent 是否在反复撞同一个已知失败的命令。
 * 读 o11y.json;skipped 与缺 o11y 返回 null(docs/feature/reports/library/measures.md「内置指标」)。
 */
export const repeatedFailedCommands = attemptMetric({
  name: "repeated-failed-commands",
  label: { en: "Repeated failed commands", "zh-CN": "重复失败命令" },
  description: "Per attempt: for each shell command failing n > 1 times, count n − 1, summed. Reads o11y — “—” if not published alongside this attempt.",
  better: "lower",
  unit: "cmds",
  bounds: { min: 0 },
  async value(a) {
    if (verdictForTerminal(a.result) === "skipped") return null;
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
