// 跨组件族共用的计算辅助:summaries(sampleSummary)、entity-lists(experimentListData)与
// 题型构成(evaluationKindComposition)共用同一套组级统计折叠,住在这里而不是任一族自己的
// compute.ts,避免重复实现分叉。

import type { AttemptHandle, Run } from "../../record/types.ts";
import { evalLevelStats } from "../../shared/verdict.ts";
import { verdictForTerminal } from "../../record/fact-record.ts";
import { experimentIdOf, fullEvalKey, type Item } from "../model/aggregate.ts";
import type { VerdictTally } from "../model/types.ts";

export function tallyOf(): VerdictTally {
  return { passed: 0, failed: 0, errored: 0, skipped: 0 };
}

/** 一批 Item 的组级统计(experimentListData / sampleSummary 共用)。 */
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
    items.map((item) => ({ verdict: verdictForTerminal(item.attempt.result), key: fullEvalKey(item) })),
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
    verdicts: { passed: stats.passed, failed: stats.failed, errored: stats.errored, skipped: stats.skipped },
    lastRunAt,
  };
}
