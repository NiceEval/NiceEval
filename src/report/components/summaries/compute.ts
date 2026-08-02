// 计算函数(*Data):ReportInput → 一份组件数据。SampleSummary 的 sampleSummary 住在这里
// (docs/feature/reports/components/summaries/README.md)。ExperimentComparison 是纯组合组件,不产生
// 独立的 data,没有对应的计算函数。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Sample | readonly Run[];issues 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露。

import type { ReportInput, SampleSummaryContent } from "../../model/types.ts";
import { collectItems, computeCell, resolveInput } from "../../model/aggregate.ts";
import { costUSD, passRate, totalScore } from "../../model/metrics.ts";
import { evaluationKindComposition } from "../../model/evaluation-kind.ts";
import { selectedAttemptsOnly, summarizeItems, tallyOf } from "../shared-compute.ts";

// ───────────────────────── sampleSummary ─────────────────────────

/** costUSD 的求和投影:两级都 sum(题内多轮求和 + 跨题求和 = 全量求和)。 */
const totalCostMetric = {
  name: "total-cost",
  label: costUSD.label,
  unit: "$",
  value: costUSD.value,
  perEval: "sum" as const,
  acrossEvals: "sum" as const,
};

/**
 * `sampleSummary(input)`:范围摘要——快照时间窗、experiment / eval / attempt 数、
 * 两级判定计票、端到端通过率与总成本(docs/feature/reports/components/summaries/sample-summary.md)。
 * data 恒携带两级计票;通过率来自官方两级指标引擎,不从任一计票重算。
 */
export async function sampleSummary(input: ReportInput): Promise<SampleSummaryContent> {
  const { runs, attempts: scopeAttempts } = resolveInput(input);
  const items = collectItems(runs, selectedAttemptsOnly(scopeAttempts));

  let earliest: string | null = null;
  let latest: string | null = null;
  for (const run of runs) {
    if (earliest === null || run.startedAt < earliest) earliest = run.startedAt;
    if (latest === null || run.startedAt > latest) latest = run.startedAt;
  }

  const stats = summarizeItems(items);
  const attemptVerdicts = tallyOf();
  for (const item of items) attemptVerdicts[item.attempt.result.verdict] += 1;

  // 题型构成:决定渲染面的主 KPI 是通过率、总分,还是两者都显示。单点判据见
  // evaluationKindComposition()(docs/feature/reports/library/measures.md「题型构成与主读数」)——
  // 不在这里另设一份 hasPoints/hasPass 判断。
  const composition = await evaluationKindComposition(input);
  const passItems = items.filter((item) => item.attempt.result.evaluationKind !== "points");

  return {
    range: { earliestStartedAt: earliest, latestStartedAt: latest },
    experiments: stats.experiments,
    evals: stats.evals,
    attempts: stats.attempts,
    evalVerdicts: stats.verdicts,
    attemptVerdicts,
    endToEndPassRate: await computeCell(passRate, passItems),
    evaluationKindComposition: composition,
    ...(composition !== "pass" ? { totalScore: await computeCell(totalScore, items) } : {}),
    totalCostUSD: await computeCell(totalCostMetric, items),
  };
}
