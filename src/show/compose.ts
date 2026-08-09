// show 专属的执行时间轴口径(--history;契约:docs/feature/reports/show.md「--history:一个 eval
// 的执行时间轴」)。逐 attempt 而非逐快照:对 Sample 中匹配的每个 experimentId + evalId 分节,
// 节内按 startedAt 升序列出跨快照按 attempt 身份键去重后的历次 attempt——时间、verdict、
// 单行结果摘要(Assertion display 契约)、耗时、成本与 locator。resume 携带的复印件不占行。
//
// 现刻水位 Sample(两个宿主共用)住在 ../sample/index.ts;本文件只留 show 独有的时间轴计算。
// 数据只消费 niceeval/record 的读取面。

import { attemptCostUSD } from "../report/model/metrics.ts";
import { compactAssertionSummary, primaryAssertionSummary, summaryText } from "../assertions/display.ts";
import type { EvalResult, Verdict } from "../types.ts";
import type { AttemptHandle, Experiment } from "../record/index.ts";
import { attemptTerminalOf, factRecordOf, scoreOutcomeOf, verdictForTerminal, type AttemptTerminal } from "../record/fact-record.ts";

// ───────────────────────── 时间轴(--history)─────────────────────────

export interface AttemptHistoryRow {
  /** 该 attempt 自己的开始时刻(ISO);第三方落盘可能缺失,如实缺省、排序沉底。 */
  startedAt?: string;
  verdict: Verdict;
  /** Fact score terminal is retained separately from its four-way tally mapping. */
  terminal: AttemptTerminal;
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
 * 单行结果摘要:与默认报告 Result 单元格同一条 display 契约(docs/feature/assertions/library/display.md)——
 * 结构化 error 取一层 message 摘要,skipped 取理由,failed 取主失败断言的紧凑单行;passed 无摘要。
 */
function rowSummary(result: EvalResult): string | undefined {
  if (result.error !== undefined) return summaryText(result.error.message);
  if (result.skipReason !== undefined) return summaryText(result.skipReason);
  const fact = factRecordOf(result);
  const score = scoreOutcomeOf(result);
  if (score !== undefined) {
    if (score.status === "invalid") return `invalid · earned ${score.earnedScore} · credited ${score.creditedScore}`;
    if (score.status === "unavailable") return `unavailable · ${score.issues[0]?.reason ?? "score evidence unavailable"}`;
    if (score.status === "errored") return `errored · ${score.errors[0]?.error.message ?? "score evaluator error"}`;
    if (score.status === "skipped") return score.reason;
  }
  if (fact !== undefined) {
    const use = fact.factUses.find((candidate) => candidate.useKind === "verdict" && candidate.outcome === "failed");
    if (use?.useKind === "verdict") return summaryText(use.label ?? use.key ?? use.method);
    return undefined;
  }
  const summary = primaryAssertionSummary(result.assertions, result.verdict, result.evaluationKind === "score" ? "score" : "pass");
  return summary === undefined ? undefined : compactAssertionSummary(summary);
}

/**
 * 一个 experimentId + evalId 的执行时间轴,去重 + 排序后的 attempt handle 全集(跨快照按身份键
 * 去重——`--resume` 携带的复印件不占行,startedAt 升序,缺 startedAt 的按发现顺序沉底)。
 * `attemptHistory` 与 `--json` 的 `history` 视图共用这份口径——前者派生单行摘要(文本渲染),
 * 后者(`attemptJsonOf`,见 `./json.ts`)投影完整落盘字段,两者不各自重新实现一遍去重 / 排序。
 */
export function attemptHistoryHandles(exp: Experiment, evalId: string): AttemptHandle[] {
  const seen = new Set<string>();
  const dated: AttemptHandle[] = [];
  const undated: AttemptHandle[] = [];
  // 新→旧扫描(exp.runs 已按新→旧排序):同一身份键保留最新落盘里的那份
  // (locator 在携带条目上原样复制,取哪份行内容相同;取最新与 dedupeAttempts 口径一致)。
  for (const run of exp.runs) {
    const ev = run.evals.find((e) => e.id === evalId);
    if (!ev) continue;
    for (const attempt of ev.attempts) {
      const key = attemptKey(attempt);
      if (key !== undefined) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      (attempt.result.startedAt === undefined ? undated : dated).push(attempt);
    }
  }
  dated.sort((a, b) => (a.result.startedAt! < b.result.startedAt! ? -1 : a.result.startedAt! > b.result.startedAt! ? 1 : 0));
  return [...dated, ...undated.reverse()];
}

/**
 * 一个 experimentId + evalId 的执行时间轴:开始时间、verdict、单行结果摘要、耗时、成本与
 * locator(`--history` 的文本行);去重 / 排序口径见 `attemptHistoryHandles`。
 */
export function attemptHistory(exp: Experiment, evalId: string): AttemptHistoryRow[] {
  return attemptHistoryHandles(exp, evalId).map((attempt) => {
    const r = attempt.result;
    return {
      ...(r.startedAt !== undefined ? { startedAt: r.startedAt } : {}),
      verdict: verdictForTerminal(r),
      terminal: attemptTerminalOf(r),
      ...(rowSummary(r) !== undefined ? { summary: rowSummary(r) } : {}),
      durationMs: r.durationMs,
      costUSD: attemptCostUSD(r),
      ...(attempt.locator !== undefined ? { locator: attempt.locator } : {}),
    };
  });
}
