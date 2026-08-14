# 计分粒度

评分语义属于 Assertions 与 Verdict，不属于 Experiment。Experiment 只选择 Eval、展开 Attempt、保存
`evaluationKind: "pass" | "score"`，并让 Report 按题型读取正确的主读数。

Pass Eval 有四态 Verdict，主读数是通过率；Score Eval 只允许 `passed | errored`，主读数是独立
Score Attachment 的 earned score 与 complete、partial、unavailable 状态。正常低分或零分恒为 passed；
execution error 不会折成零。只有 passed + complete 参与比较。

`points` 是 Score Eval 内 Assertion 的分值和计算单位，不是 Evaluation kind，也不是 Experiment 字段。
完整契约见 [Assertions · Score Eval](../assertions/library/score-points.md)。
