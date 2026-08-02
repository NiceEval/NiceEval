// AttemptHandle -> 完整源码调用树的薄组合层。入口由 SourceArtifact.role 决定，绝不按断言
// 命中数猜；展示选项只在 report task 的 projectSourceView() 阶段生效。

import type { SourceLoc } from "../types.ts";
import type { AttemptHandle } from "./types.ts";
import {
  assembleSourceTree,
  type AnnotatedSourceTree,
  type SendAnnotation,
} from "./annotated-source.ts";

/** AttemptSource 与计分明细共用同一棵证据树，而非各自按 loc 再分桶。 */
export async function loadAttemptSourceTree(
  attempt: AttemptHandle,
  sends: readonly SendAnnotation[] = [],
): Promise<AnnotatedSourceTree | null> {
  const sources = await attempt.sources();
  if (!sources?.length) return null;
  const entry = sources.find((source) => source.role === "entry");
  if (!entry) return null;
  return assembleSourceTree({
    entry,
    sources,
    assertions: attempt.result.assertions,
    scoreEntries: attempt.result.scoreEntries ?? [],
    sends,
    abort: firstFailedStopOnFailureLoc(attempt.result.assertions),
  });
}

/** 只取首条真正触发前置中止的断言；后续已记录的断言不能把中止锚点推到最后一条。 */
function firstFailedStopOnFailureLoc(assertions: Readonly<AttemptHandle["result"]["assertions"]>): SourceLoc | undefined {
  for (const assertion of assertions) {
    if (assertion.outcome === "failed" && assertion.stopOnFailure === true) return assertion.loc;
  }
  return undefined;
}
