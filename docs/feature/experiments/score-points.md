# 计分粒度

评分语义属于 Assertions 与 Verdict，不属于 Experiment。Experiment 只选择 Eval、展开 Attempt、保存
`evaluationKind: "pass" | "score"`，并让 Report 按题型读取正确的主读数。

每个 Attempt 都有四态 Verdict。Pass Eval 的主读数是 Verdict 的通过率；Score Eval 的主读数是独立
Score Attachment 的 earned score 与 complete、partial、unavailable 状态。gate failed 的 Score Attempt
仍保留 earned score，execution error 不会折成零。

`points` 是 Score Eval 内 Assertion 的分值和计算单位，不是 Evaluation kind，也不是 Experiment 字段。
完整契约见 [Assertions · Score Eval](../assertions/library/score-points.md)。
