// show 专属的跨 run 时间轴口径(--history;docs-site/zh/guides/viewing-results.mdx 是行为规范)。
//
// 现刻水位 Selection(两个宿主共用)住在 ../results/select.ts 的 selectCurrentResults;
// 本文件只留 show 独有的时间轴计算:每个快照 / 每次真实执行一行,resume 携带的复印件不占行。
// 数据只消费 niceeval/results 的读取面。

import { foldEvalVerdict } from "../shared/verdict.ts";
import { attemptCostUSD } from "../report/metrics.ts";
import type { Verdict } from "../types.ts";
import type { AttemptHandle, Experiment } from "../results/index.ts";

// ───────────────────────── 时间轴(--history)─────────────────────────

export interface EvalHistoryRow {
  /** 该次真实执行所在 run(快照)的时刻。 */
  startedAt: string;
  verdict: Verdict;
  attempts: number;
  costUSD: number | null;
  /** 最新一次 attempt 的第一条失败断言("gate calledTool(...)")。 */
  failedAssertion?: string;
  /** errored 时的错误摘要。 */
  error?: string;
}

/** attempt 的身份键(去重口径与 dedupeAttempts 一致);缺 startedAt 时不参与去重(宁可多列不误删)。 */
function attemptKey(attempt: AttemptHandle): string | undefined {
  const r = attempt.result;
  return r.startedAt === undefined ? undefined : `${r.attempt}|${r.startedAt}`;
}

/**
 * 单 eval 的跨 run 时间轴:每次真实执行一行,新→旧。--resume 携带的复印件
 * (身份键与原判定相同的条目)不占行 —— 否则趋势会被复印件灌满假数据。
 */
export function evalHistory(exp: Experiment, evalId: string): EvalHistoryRow[] {
  const rows: EvalHistoryRow[] = [];
  const seen = new Set<string>();
  // 旧→新扫描,首次出现的身份键 = 真实执行;最后整体反转成新→旧
  for (const snapshot of [...exp.snapshots].reverse()) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (!ev) continue;
    const fresh: AttemptHandle[] = [];
    for (const attempt of ev.attempts) {
      const key = attemptKey(attempt);
      if (key === undefined) {
        fresh.push(attempt);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(attempt);
    }
    if (fresh.length === 0) continue; // 纯复印件:判定在更早的行里已经出现过
    let cost: number | null = null;
    for (const attempt of fresh) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    const latest = fresh[fresh.length - 1];
    const failed = latest.result.assertions.find((a) => a.outcome !== "passed");
    rows.push({
      startedAt: snapshot.startedAt,
      verdict: foldEvalVerdict(fresh.map((a) => a.result)),
      attempts: fresh.length,
      costUSD: cost,
      ...(failed ? { failedAssertion: `${failed.severity} ${failed.name}` } : {}),
      ...(latest.result.error !== undefined ? { error: latest.result.error.message } : {}),
    });
  }
  return rows.reverse();
}

export interface ExperimentHistoryRow {
  startedAt: string;
  passedEvals: number;
  totalEvals: number;
  costUSD: number | null;
}

/** 实验级 per-run 通过率序列(裸 `show --history`):每个快照一行,新→旧。 */
export function experimentHistory(exp: Experiment): ExperimentHistoryRow[] {
  return exp.snapshots.map((snapshot) => {
    let passed = 0;
    for (const ev of snapshot.evals) {
      if (foldEvalVerdict(ev.attempts.map((a) => a.result)) === "passed") passed += 1;
    }
    let cost: number | null = null;
    for (const attempt of snapshot.attempts) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    return { startedAt: snapshot.startedAt, passedEvals: passed, totalEvals: snapshot.evals.length, costUSD: cost };
  });
}
