// show 专属的执行时间轴口径(--history;契约:docs/feature/reports/show.md「--history:一个 eval
// 的执行时间轴」)。逐 attempt 而非逐快照:对 Scope 中匹配的每个 experimentId + evalId 分节,
// 节内按 startedAt 升序列出跨快照按 attempt 身份键去重后的历次 attempt——时间、verdict、
// 单行结果摘要(Scoring display 契约)、耗时、成本与 locator。resume 携带的复印件不占行。
//
// 现刻水位 Scope(两个宿主共用)住在 ../results/select.ts;本文件只留 show 独有的时间轴计算。
// 数据只消费 niceeval/results 的读取面。

import { attemptCostUSD } from "../report/metrics.ts";
import { compactAssertionSummary, primaryAssertionSummary, summaryText } from "../scoring/display.ts";
import type { EvalResult, Verdict } from "../types.ts";
import type { AttemptHandle, Experiment } from "../results/index.ts";

// ───────────────────────── 时间轴(--history)─────────────────────────

export interface AttemptHistoryRow {
  /** 该 attempt 自己的开始时刻(ISO);第三方落盘可能缺失,如实缺省、排序沉底。 */
  startedAt?: string;
  verdict: Verdict;
  /** 单行结果摘要(display 契约):主失败断言 / 结构化 error 一层摘要 / skip 理由;passed 缺省。 */
  summary?: string;
  durationMs: number;
  costUSD: number | null;
  /** attempt 的稳定引用(`@` 前缀),复制给 `niceeval show @<locator>` 下钻。 */
  locator?: string;
}

/** attempt 的身份键(去重口径与 results 的 dedupeAttempts 一致);缺 startedAt 时不参与去重(宁可多列不误删)。 */
function attemptKey(attempt: AttemptHandle): string | undefined {
  const r = attempt.result;
  return r.startedAt === undefined ? undefined : `${r.attempt}|${r.startedAt}`;
}

/**
 * 单行结果摘要:与榜单 Result 单元格同一条 display 契约(docs/feature/scoring/library/display.md)——
 * 结构化 error 取一层 message 摘要,skipped 取理由,failed 取主失败断言的紧凑单行;passed 无摘要。
 */
function rowSummary(result: EvalResult): string | undefined {
  if (result.error !== undefined) return summaryText(result.error.message);
  if (result.skipReason !== undefined) return summaryText(result.skipReason);
  const summary = primaryAssertionSummary(result.assertions, result.verdict);
  return summary === undefined ? undefined : compactAssertionSummary(summary);
}

/**
 * 一个 experimentId + evalId 的执行时间轴:跨快照收集全部 attempt,按身份键去重
 * (--resume 携带的复印件不占行),startedAt 升序;缺 startedAt 的行按发现顺序沉底。
 */
export function attemptHistory(exp: Experiment, evalId: string): AttemptHistoryRow[] {
  const seen = new Set<string>();
  const dated: AttemptHistoryRow[] = [];
  const undated: AttemptHistoryRow[] = [];
  // 新→旧扫描(exp.snapshots 已按新→旧排序):同一身份键保留最新落盘里的那份
  // (locator 在携带条目上原样复制,取哪份行内容相同;取最新与 dedupeAttempts 口径一致)。
  for (const snapshot of exp.snapshots) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (!ev) continue;
    for (const attempt of ev.attempts) {
      const key = attemptKey(attempt);
      if (key !== undefined) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const r = attempt.result;
      const row: AttemptHistoryRow = {
        ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
        verdict: r.verdict,
        ...(rowSummary(r) !== undefined ? { summary: rowSummary(r) } : {}),
        durationMs: r.durationMs,
        costUSD: attemptCostUSD(r),
        ...(attempt.locator !== undefined ? { locator: attempt.locator } : {}),
      };
      (row.startedAt === undefined ? undated : dated).push(row);
    }
  }
  dated.sort((a, b) => (a.startedAt! < b.startedAt! ? -1 : a.startedAt! > b.startedAt! ? 1 : 0));
  return [...dated, ...undated.reverse()];
}
