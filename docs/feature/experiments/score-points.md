# 计分粒度

评分语义属于 Assertions 与 Verdict，不属于 Experiment。Experiment 只选择 Eval、展开 Attempt、保存
`evaluationKind: "pass" | "score"`，并让固定 Inspection 按题型读取正确的主读数。

一个 Experiment 的实际选择必须同型：要么全是 Pass Eval，要么全是 Score Eval。通过率与 earned score 没有共同单位，
不能作为同一 Experiment 的主读数；混型在启动前作为配置错误拒绝。Inspection 仍按两种读数分别解释历史 Record。

Pass Eval 的主读数是 Verdict 通过率；Score Eval 的主读数是 sealed Assertions score facts 的 earned score 与
complete、partial、unavailable 状态，但同样保留四态 Verdict。Score Inspection 不能用 `scored` 或 complete 取代 `failed`；
失败项不进入成功排名，已经形成的 earned score 仍用于审计。execution error 不会折成零，合法的 `passed + complete 0` 可以参与比较。

同一 Score Eval 的多个 `passed + complete` Attempt 取 earned 的算术平均并显示 `complete / total`；`failed + complete` 保留数值但不进入成功 mean，partial 不进入 mean，
只显示已知下界，unavailable 不产生数字。一个 config 的 `Total score` 是各 Score Eval earned 的总和。

`points` 是 Score Eval 内 Assertion 的分值和计算单位，不是 Evaluation kind，也不是 Experiment 字段。
完整契约见 [Assertions · Score Eval](../assertions/library/score-points.md)。
