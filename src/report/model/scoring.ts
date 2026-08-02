// 题型构成的单点判据(docs/feature/reports/library/measures.md「题型构成与主读数」):一个
// 范围的对比主读数由其中出现的题型决定——通过制读通过率,计分制读总分,混型两者并排、
// 各读各的。题型是定义期事实(EvalDescriptor.scoring,同一个 experiment 也可以选择混型 Eval),
// 所以这个判断不依赖任何 attempt 执行结果。官方消费者(ScopeSummary 的渲染面、
// ExperimentList 的主列、ExperimentComparison 的 compose 步骤)都调用这一个函数判定构成,
// 不各自另设判据。

import { collectItems, resolveInput } from "./aggregate.ts";
import type { ReportInput, ScoringComposition } from "./types.ts";
import { selectedAttemptsOnly } from "../components/shared-compute.ts";

/**
 * `input` 内出现的题型构成,取自快照记录的定义期 `scoring` 事实(`EvalDescriptor.scoring`,
 * 省略或 `"pass"` 记通过制、`"points"` 记计分制)。
 *
 * 这是主读数选择的单点规则:`ScopeSummary`、`ExperimentList` 的主列、`ExperimentComparison`
 * 的 compose 步骤都调用这一个函数,不各自重新发明「pass vs points vs mixed」的判断。自定义
 * 报告需要同样的切换时也应该调用它,而不是重新读 `attempt.result.scoring` 另写一份等价逻辑。
 *
 * 判据只看题目的定义期事实,不看执行是否发生——一个 eval 一行代码没跑时,它的 `scoring`
 * 依然是已知的,题型构成因此不依赖任何 attempt 结果(`errored` / `unreadable` 的 attempt 不
 * 改变所属 eval 的题型归属)。
 *
 * @param input Sample,或手工挑选的快照数组。
 * @returns `"pass"`:范围内全部通过制;`"points"`:全部计分制;`"mixed"`:同一范围内并排
 *   出现两种题型——混型既可能来自同一个 experiment,也可能来自不同 experiment 并排
 *   (docs/feature/experiments/score-points.md)。
 */
export async function scoringComposition(input: ReportInput): Promise<ScoringComposition> {
  const { runs, attempts } = resolveInput(input);
  const items = collectItems(runs, selectedAttemptsOnly(attempts));
  const hasPoints = items.some((item) => item.attempt.result.scoring === "points");
  const hasPass = items.some((item) => item.attempt.result.scoring !== "points");
  return hasPoints && hasPass ? "mixed" : hasPoints ? "points" : "pass";
}
