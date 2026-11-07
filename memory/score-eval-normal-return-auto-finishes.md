# 裁决：Score Eval 正常返回自动收尾，空计分是零分

**日期**：2026-08-10

`defineScoreEval.test` 与 `defineEval.test` 共享受管 callback 生命周期。函数正常返回就是收集边界，Runner 在该边界检查悬空 Fact 与未完成 requirement，并同步关闭 collector。作者不返回额外完成令牌。

没有 score use 的正常路径是合法的绝对零分：Attempt 为 `scored`，`earnedScore` 与 `creditedScore` 都是 0，Fact/use 图保持为空。这个非 null 的 0 进入同题平均与跨题求和，并按成功 Attempt 参与首过即停。它不是缺失分数，也不是比例意义的 `0/0`。

本裁决替代 [评估事实与判定、控制流、计分分离](evaluation-facts-separate-verdict-and-score.md) 第 6 条中的 `ScoreCompletion`、`finishScore()` 与“至少一个 score use”要求。该裁决其余部分保持有效。

内部仍保留真正的 closed 状态。正常返回边界通过全部同步检查后立即封口，避免 detached async 在 callback 已返回后继续登记 Fact 或 score；Runner 不追踪作者自行启动且未返回、未等待的任意 Promise。

不升级 Record schema 或 `fact-use/v2`。既有 fold 已能从空图得到 `scored / 0 / 0`，无需合成占位 score use。
