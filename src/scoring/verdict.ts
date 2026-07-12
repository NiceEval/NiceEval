// 判定:把执行结果 + 断言 + 跳过原因折叠成一个 Verdict(见 docs/feature/scoring/README.md)。

import type { AssertionResult, Verdict } from "../types.ts";

export function computeVerdict(input: {
  error?: string;
  assertions: readonly AssertionResult[];
  skipReason?: string;
  strict?: boolean;
}): Verdict {
  if (input.error !== undefined) return "errored";

  for (const a of input.assertions) {
    if (a.passed) continue;
    if (a.severity === "gate" || input.strict) return "failed";
  }

  if (input.skipReason !== undefined) return "skipped";
  return "passed";
}
