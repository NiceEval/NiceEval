// 逐 (experiment, eval) 结论行的纯派生:human/json 两个 profile 共用同一份计算,不各自维护
// 第二份口径(docs/feature/experiments/cli.md「runs 与首过即停怎样展示」)。
//
// "代表 attempt" 的选取:earlyExit 触发时是命中通过的那一次(该 eval 组内 verdict === "passed"
// 且 attempt 序号最小的一条——首过即停只可能由一次通过触发省略,取最小序号在理论上的并发竞态下
// 仍给出确定性结果);跑满时是最后完成的一次,用 attempt 序号最大的一条近似(EvalResult 没有独立
// 的"完成时刻"字段,attempt 序号是调度顺序里最接近"最后"的确定性代理)。
//
// budget 未派发的 attempt 没有对应 EvalResult,也不产生 `attempt:early-exit` 事件——它们不进
// earlyExitByEval,这个函数因此不会为它们编出 planned/unstarted。那类缺口只反映在 Invocation
// 级完成状态(`incomplete`),这里不重复那层判断(docs/runner.md「完成状态」)。
//
// fail-fast 未派发复用同一个 `attempt:early-exit` 事件类型(见 run.ts),`earlyExitByEval` 因此
// 是未经剔除的原始计数;这里对照 `diagnostics` 里同一 identity 的 `fail-fast:` 记录减去那部分
// (与 cli.ts 的 `assembleInvocationCompletion()` 用同一份 `diagnostics` 算 Invocation 级
// `earlyExitUnstarted` 是同一个判别原则,只是这里按 (experiment, eval) 分组而不是全局求和)——
// 不依赖 run.ts 里两个事件谁先谁后这类隐式顺序契约,只读两份已经落定的最终计数。

import type { DiagnosticNotice, EvalResult } from "../types.ts";
import type { Verdict } from "../../shared/types.ts";

/** `earlyExitByEval` 与结论行分组共用的同一把 key——两处必须同源,不能各写一份拼法。 */
export function evalConclusionKey(ref: { experimentId?: string; evalId: string }): string {
  return `${ref.experimentId ?? ""}|${ref.evalId}`;
}

export interface EvalConclusionRow {
  experimentId?: string;
  evalId: string;
  /** 代表 attempt 的 locator;第三方 harness 落盘的结果可能没有,原样透出 undefined。 */
  locator: string | undefined;
  verdict: Verdict;
  attempts: number;
  /** earlyExit 触发(该 eval 确有省略)时给出;跑满时省略。 */
  planned?: number;
  unstarted?: number;
  reason?: "early_exit";
  /** 跑满(该 eval 没有省略)时给出;earlyExit 触发时省略。 */
  passed?: number;
  rate?: number;
}

/** `diagnostics` 里 fail-fast 记录按 (experiment, eval) 求和的未派发次数;没有 `identity`
 *  的记录(理论上不应出现——fail-fast 诊断恒带 identity,见 run.ts)不计入任何 key。
 *  归类按稳定词法 `code`(省略时回落到 key 首段,缺省 key 恒是 `${code}:${identity}`),不按
 *  `key` 前缀:key 里编着折叠身份,拿它匹配会在身份编码变动时静默失配,减不掉的那部分
 *  fail-fast 份额会当成真实的 earlyExit 省略数报出去。 */
function failFastByEval(diagnostics: readonly DiagnosticNotice[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const d of diagnostics) {
    if ((d.code ?? d.key.split(":", 1)[0]) !== "fail-fast" || !d.identity) continue;
    const key = evalConclusionKey(d.identity);
    result.set(key, (result.get(key) ?? 0) + d.count);
  }
  return result;
}

/**
 * `results`:一次 Invocation 落最终 verdict 的全部 attempt(`InvocationSummary.results`,含携带
 * 条目)。`earlyExitByEval`:reducer 累计的 `attempt:early-exit` 原始次数(未剔除 fail-fast 份额,
 * 见 `RunFeedbackState.earlyExitByEval` 的字段注释)。`diagnostics`:同一份 `RunFeedbackState`
 * 上的诊断列表,用来算出每个 (experiment, eval) 该减掉多少 fail-fast 份额。按 `results` 中每个
 * (experiment, eval) 首次出现的顺序返回,顺序稳定。
 */
export function evalConclusionRows(
  results: readonly EvalResult[],
  earlyExitByEval: ReadonlyMap<string, number>,
  diagnostics: readonly DiagnosticNotice[],
): EvalConclusionRow[] {
  const failFast = failFastByEval(diagnostics);
  const order: string[] = [];
  const groups = new Map<string, EvalResult[]>();
  for (const r of results) {
    const key = evalConclusionKey({ experimentId: r.experimentId, evalId: r.id });
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(r);
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const unstarted = Math.max(0, (earlyExitByEval.get(key) ?? 0) - (failFast.get(key) ?? 0));
    const attempts = group.length;

    if (unstarted > 0) {
      const hit = [...group].sort((a, b) => a.attempt - b.attempt).find((r) => r.verdict === "passed") ?? group[0]!;
      return {
        experimentId: hit.experimentId,
        evalId: hit.id,
        locator: hit.locator,
        verdict: hit.verdict,
        attempts,
        planned: attempts + unstarted,
        unstarted,
        reason: "early_exit" as const,
      };
    }

    const last = [...group].sort((a, b) => b.attempt - a.attempt)[0]!;
    const passed = group.filter((r) => r.verdict === "passed").length;
    return {
      experimentId: last.experimentId,
      evalId: last.id,
      locator: last.locator,
      verdict: last.verdict,
      attempts,
      passed,
      rate: Math.round((passed / attempts) * 1000) / 1000,
    };
  });
}
