# 计分粒度

评分语义属于 Assertions 与 Verdict，不属于 Experiment。Experiment 只选择 Eval、展开 Attempt、保存
`evaluationKind: "pass" | "score"`，并让 Report 按题型读取正确的主读数。

Pass Eval 有四态 Verdict，主读数是通过率；Score Eval 的主读数是 sealed Assertions score facts 的 earned score 与
complete、partial、unavailable 状态。Score Analysis 使用 scored、skipped、errored，通用摘要把 scored 映射为 passed；
execution error 不会折成零。只有 scored + complete 参与比较，raw legacy failed 不进入 Score failed 计数。

`points` 是 Score Eval 内 Assertion 的分值和计算单位，不是 Evaluation kind，也不是 Experiment 字段。
完整契约见 [Assertions · Score Eval](../assertions/library/score-points.md)。
