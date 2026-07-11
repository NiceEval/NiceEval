// reporter 共用的展示常量。符号表只此一份 —— console/live/table 各抄一份时,
// 改一个符号要同步三处且不报错。

import type { Verdict } from "../../types.ts";

export const VERDICT_SYM: Record<Verdict, string> = {
  passed: "✓",
  failed: "✗",
  errored: "!",
  skipped: "○",
};

export function verdictSymbol(verdict: string): string {
  return VERDICT_SYM[verdict as Verdict] ?? "?";
}

/** live 表格里「还没抢到并发名额」的行:和转圈的 SPINNER、完成后的 VERDICT_SYM 三态区分开。 */
export const WAITING_SYM = "·";
