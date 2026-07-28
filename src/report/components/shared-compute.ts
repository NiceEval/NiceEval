// 跨组件族共用的计算辅助:summaries(scopeSummaryData)、entity-lists(experimentListData)、
// scoring(scoringComposition)与 metric-views(metricScatterData)共用同一条 selectedEvalIds
// 投影规则与同一套组级统计折叠,住在这里而不是任一族自己的 compute.ts,避免重复实现分叉。

import type { AttemptHandle, Run } from "../../record/types.ts";
import { selectedEvalIdsOf } from "../../sample/index.ts";
import { evalLevelStats } from "../../shared/verdict.ts";
import { experimentIdOf, fullEvalKey, type Item } from "../model/aggregate.ts";
import type { VerdictTally } from "../model/types.ts";

/**
 * 每个 attempt 只在其真实来源快照声明的 `selectedEvalIds` 内才保留——两个来源(不同
 * experiment,或手挑快照)声明不同 eval 集时各自只统计自己选中的那部分,未选择的 eval
 * (即使恰好在同一次运行里跑过)不进分母、不污染另一个来源。第三方快照缺该字段时
 * `selectedEvalIdsOf` 退化为其实际 evals,过滤天然是 no-op。宿主注入的 `current()` Sample
 * 在选择时已按这条规则收窄,这里对真实 Sample 是幂等的;只对作者手工拼的 `Run[]`
 * 真正生效。`experimentListData` / `scopeSummaryData` / `scoringComposition` /
 * `metricScatterData` 共用同一条规则,保证经 `ExperimentComparison` 展开后收到的 spec 与
 * 直接调用同一份 input 深相等。
 */
export function selectedAttemptsOnly(attempts: readonly AttemptHandle[]): AttemptHandle[] {
  const selectedByExperimentSnapshot = new Map<Run, Set<string>>();
  return attempts.filter((a) => {
    let selected = selectedByExperimentSnapshot.get(a.run);
    if (!selected) selectedByExperimentSnapshot.set(a.run, (selected = new Set(selectedEvalIdsOf(a.run))));
    return selected.has(a.evalId);
  });
}

export function tallyOf(): VerdictTally {
  return { passed: 0, failed: 0, errored: 0, unreadable: 0 };
}

/** 一批 Item 的组级统计(experimentListData / scopeSummaryData 共用)。 */
export function summarizeItems(items: Item[]): {
  experiments: number;
  evals: number;
  attempts: number;
  verdicts: VerdictTally;
  lastRunAt: string | undefined;
} {
  const experimentIds = new Set<string>();
  for (const item of items) experimentIds.add(experimentIdOf(item));
  const stats = evalLevelStats(
    items.map((item) => ({ verdict: item.attempt.result.verdict, key: fullEvalKey(item) })),
    (r) => r.key,
  );
  let lastRunAt: string | undefined;
  for (const item of items) {
    const startedAt = item.run.startedAt;
    if (lastRunAt === undefined || startedAt > lastRunAt) lastRunAt = startedAt;
  }
  return {
    experiments: experimentIds.size,
    evals: stats.evals,
    attempts: items.length,
    verdicts: { passed: stats.passed, failed: stats.failed, errored: stats.errored, unreadable: stats.unreadable },
    lastRunAt,
  };
}
