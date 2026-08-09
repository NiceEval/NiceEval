// AttemptHandle -> 完整源码调用树的薄组合层。入口由 SourceArtifact.role 决定，绝不按断言
// 命中数猜；展示选项只在 report task 的 projectSourceView() 阶段生效。

import type { SourceLoc } from "../types.ts";
import type { AttemptHandle } from "./types.ts";
import { materializeFactRecord } from "./fact-record.ts";
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
  const result = materializeFactRecord(attempt.result);
  return assembleSourceTree({
    entry,
    sources,
    factResults: result.factResults,
    factUses: result.factUses,
    legacyJudgeAssertions: result.legacyJudgeAssertions,
    sends,
    abort: firstControlFailureLoc(result),
  });
}

/** `require` 与 legacy Judge stop 都是控制流边界；取最早声明处标记后续源码不可达。 */
function firstControlFailureLoc(result: ReturnType<typeof materializeFactRecord>): SourceLoc | undefined {
  const candidates = [
    ...result.factUses.flatMap((use) =>
      use.useKind === "verdict" && use.method === "require" && use.outcome !== "passed" && use.consumerLoc
        ? [{ order: use.sourceOrder, loc: use.consumerLoc }]
        : []
    ),
    ...result.legacyJudgeAssertions.flatMap((judge) =>
      judge.policy.stopOnFailure === true && judge.outcome === "failed" && judge.loc
        ? [{ order: judge.sourceOrder, loc: judge.loc }]
        : []
    ),
  ];
  candidates.sort((left, right) => left.order - right.order);
  return candidates[0]?.loc;
}
