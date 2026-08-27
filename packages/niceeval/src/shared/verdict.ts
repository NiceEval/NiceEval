// Server and report bundles share this four-state Verdict vocabulary. Keep it
// environment-neutral: Score is a separate attachment and never changes this
// fold or its tally.

import type { Verdict } from "./types.ts";

/** A consumer needs exactly the sealed four-state Verdict. */
import type { EvaluationKind } from "./evaluation.ts";

export interface VerdictLike {
  readonly verdict: Verdict;
  readonly evaluationKind?: EvaluationKind;
  readonly scoreResult?: {
    readonly status: "scored" | "invalid" | "unavailable" | "errored" | "skipped";
  };
}

/** Score uses its scoring outcome as the public terminal; Verdict remains the immutable audit claim. */
export function attemptTerminalOf<T extends VerdictLike>(attempt: T): Verdict {
  if (attempt.evaluationKind === "score") {
    switch (attempt.scoreResult?.status) {
      case "scored":
        return "passed";
      case "skipped":
        return "skipped";
      case "invalid":
      case "unavailable":
      case "errored":
      case undefined:
        return "errored";
    }
  }
  return attempt.verdict;
}

/** Accept a boundary string defensively, but only expose a real Verdict. */
export function verdictForTerminal(terminal: string): Verdict {
  switch (terminal) {
    case "passed":
    case "failed":
    case "errored":
    case "skipped":
      return terminal;
    default:
      return "errored";
  }
}

/**
 * An Eval passes when any Attempt passed. Otherwise retain the most useful
 * terminal state without deriving anything from Score.
 */
export function foldEvalTerminal<T extends VerdictLike>(attempts: readonly T[]): Verdict {
  if (attempts.some((attempt) => attempt.verdict === "passed")) return "passed";
  if (attempts.some((attempt) => attempt.verdict === "failed")) return "failed";
  if (attempts.some((attempt) => attempt.verdict === "errored")) return "errored";
  return "skipped";
}

export function foldEvalVerdict<T extends VerdictLike>(attempts: readonly T[]): Verdict {
  return foldEvalTerminal(attempts);
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
 * 通过率与 passed/failed 一律按 eval 计票,不按 attempt:每个 eval 不管跑几轮都只占一票,
 * 先把它的多轮折叠成单一 Verdict。否则 runs>1 时同一 eval 的 N 次 attempt 各算一票 ——
 * 尤其 earlyExit 开时通过的 eval 只留 1 次、失败的 eval 跑满 N 次,失败 eval 被重复计入
 * 分母,把通过率拉低。keyOf 决定「一个 eval」的粒度:单实验按 eval id,跨实验组按
 * experimentId|eval id。
 */
export function evalLevelStats<T extends VerdictLike>(results: readonly T[], keyOf: (r: T) => string): EvalLevelStats {
  const byEval = new Map<string, T[]>();
  for (const result of results) byEval.set(keyOf(result), [...(byEval.get(keyOf(result)) ?? []), result]);
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const group of byEval.values()) counts[foldEvalVerdict(group)] += 1;
  const ran = counts.passed + counts.failed + counts.errored; // skipped 不进分母
  return { evals: byEval.size, ...counts, passRate: ran ? counts.passed / ran : 0 };
}
