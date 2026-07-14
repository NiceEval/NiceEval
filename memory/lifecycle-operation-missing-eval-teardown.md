# LifecycleOperationName 没有 eval 的 teardown/cleanup 项

## 现象

落地 v6 结构化结果错误(`AttemptError` / `DiagnosticRecord`,见
`docs/feature/results/architecture.md` 的 `result.json`)时,两者的 `operation` 字段都取自封闭集合
`LifecycleOperationName`。这个集合按「setup / run」维度列 operation:`eval.setup` / `eval.run` 有,
但 eval 没有 teardown 侧的项;而 agent、sandbox 都有 teardown 侧(`agent.teardown` /
`sandbox.teardown` / `sandbox.stop`)。

`src/runner/attempt.ts` 的 attempt 收尾 `finally` 里确实会跑 `eval.setup` 返回的 cleanup,失败时
要发一条 `DiagnosticRecord`,`operation` 却没有一个语义精确的值可填。

## 根因

契约的 operation 集合是按扩展点的「安装 / 执行」两态列的,只有 agent 与 sandbox 被显式给了
teardown 态;eval 的 cleanup(由 `eval.setup` 返回的清理函数)在设计集合时没有单独成项。

## 修法(取舍,契约未修)

eval cleanup 失败的诊断按 **owner** 归到 `"eval.setup"`(注册这个 cleanup 的那次操作),不新造
契约外的 operation 字面量——`operation` 是封闭 union,凭空加值会让类型与文档漂移。落点:
`src/runner/attempt.ts` 的 teardown `finally`(`teardownDiagnostic("eval.setup", e)`),其余三处
分别归 `agent.teardown` / `sandbox.teardown`。

后续若要把「eval 的清理失败」与「eval 的 setup 失败」在结果里区分开,应先给
`docs/feature/results/architecture.md` 的 `LifecycleOperationName` 补一个 `eval.teardown`(或
`eval.cleanup`)项,再改这里的映射——先文档后代码。契约本身未修。
