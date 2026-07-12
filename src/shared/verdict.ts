// server(aggregate.ts)与前端(app/lib/verdict.ts)共用的判定折叠口径。
// 必须保持环境无关且只依赖 type import,vite 前端会直接打包它。
// 单独成模块的原因:折叠/计票口径两边必须逐字一致,否则折叠行状态会和 KPI / 成功率对不上。

import type { Verdict } from "../types.ts";

/** 折叠/计票只需要 verdict 字段;server 传 EvalResult,前端传 ViewResult 都满足。 */
export interface VerdictLike {
  verdict: Verdict;
}

/**
 * 把同一个 eval 的多轮 attempt 折叠成单一判定:任一轮通过 → 该 eval 通过(对齐 earlyExit
 * 「先过一次即停」语义),否则按 failed > errored > skipped 取最严重的一个。
 */
export function foldEvalVerdict(attempts: VerdictLike[]): Verdict {
  const verdicts = attempts.map((a) => a.verdict);
  if (verdicts.some((o) => o === "passed")) return "passed";
  if (verdicts.some((o) => o === "failed")) return "failed";
  if (verdicts.some((o) => o === "errored")) return "errored";
  return "skipped";
}

export interface EvalLevelStats {
  /** 去重后的 eval 数(成功率分母的口径)。 */
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  passRate: number;
}

/**
 * 通过率与 passed/failed 一律按 eval 计票,不按 attempt:每个 eval 不管跑几轮都只占一票,先把它
 * 的多轮折叠成单一判定再计数。否则 runs>1 时同一 eval 的 N 次 attempt 各算一票 —— 尤其 earlyExit
 * 开时通过的 eval 只留 1 次、失败的 eval 跑满 N 次,失败 eval 被重复计入分母,把通过率拉低
 * (见 docs/runner.md、docs/feature/scoring/README.md)。keyOf 决定「一个 eval」的粒度:单实验按 eval id,
 * 跨实验组按 experimentId|eval id。
 */
export function evalLevelStats<T extends VerdictLike>(results: T[], keyOf: (r: T) => string): EvalLevelStats {
  const byEval = new Map<string, T[]>();
  for (const r of results) byEval.set(keyOf(r), [...(byEval.get(keyOf(r)) ?? []), r]);
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const group of byEval.values()) counts[foldEvalVerdict(group)] += 1;
  const ran = counts.passed + counts.failed + counts.errored; // skipped 不进分母
  return { evals: byEval.size, ...counts, passRate: ran ? counts.passed / ran : 0 };
}
