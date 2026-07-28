// 判定:把执行结果 + 断言 + 跳过原因折叠成一个 Verdict
// (见 docs/feature/verdict/architecture.md)。固定优先级取第一个成立项:
//   执行异常 / 任一非 optional 断言 unavailable → errored
//   任一 gate 不通过,或 strict 下 soft 低于阈值 → failed
//   显式 t.skip(reason)                         → unreadable
//   否则                                        → passed
// errored 压过一切(执行证据已不可信);failed 压过 unreadable(t.skip 不掩盖已记录的硬失败)。

import type { AssertionResult, AttemptError, Verdict } from "../types.ts";

export function computeVerdict(input: {
  error?: AttemptError;
  assertions: readonly AssertionResult[];
  skipReason?: string;
  strict?: boolean;
  /**
   * 题型(默认通过制)。计分制的 failed 只有一个来源——前置 `.gate()` 中止(它记为 gate 断言)。
   * 丢分不是失败:得分点与观测都是 soft,`--strict` 在计分制没有「带线 soft」可翻(那套词汇
   * 在计分制的 `t` 上不存在),因此这里不读 strict。见 score-points.md「Verdict 回答的是
   * 这次的分数完不完整」。
   */
  scoring?: "pass" | "points";
}): Verdict {
  if (input.error !== undefined) return "errored";

  // 作者写下的每条断言默认都要求可评估:非 optional 的 unavailable 使 attempt errored,
  // 不分 gate / soft——「soft 全部评不了但 attempt 还绿着」是没有测量的绿,不允许出现。
  for (const a of input.assertions) {
    if (a.outcome === "unavailable" && !a.optional) return "errored";
  }

  const strict = input.scoring === "points" ? false : input.strict;
  for (const a of input.assertions) {
    if (a.outcome !== "failed") continue;
    if (a.severity === "gate" || strict) return "failed";
  }

  if (input.skipReason !== undefined) return "unreadable";
  return "passed";
}
