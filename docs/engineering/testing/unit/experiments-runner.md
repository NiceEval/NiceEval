# Experiments 与 Runner 怎么测

契约出处：[Experiments](../../../feature/experiments/README.md)、[Experiments Architecture](../../../feature/experiments/architecture.md)、[Experiments CLI](../../../feature/experiments/cli.md)、[Runner](../../../runner.md) 与 [Record](../../../feature/record/README.md)。

Runner 单元层关心 Attempt 集合、开始条件、停止派发、资源释放和 Record writer 调用。它不锁定内部循环、Promise 数量或 Effect combinator。真实进程、真实 Sandbox 与最终 Record 由 E2E owner 验收。

## Fixture 规范

Runner fixture 以声明式场景给出 expected slots、并发上限、Attempt 结果、Verdict/eligibility channel 状态与受控 barrier。fake Agent、Sandbox、Provider 和 writer 只模拟所属边界，不复制规划器、携带判定或通道编码。

并发用 barrier 观察在飞集合，不用 `setTimeout` 猜时序。重试和 backoff 使用 TestClock。Effect 程序由测试 runtime 持有 Scope；每例需要隔离的 Layer 不跨例共享。

## 最小证明面

- **展开与分母**：选中的 Experiment 先形成 Run 与 expected slots。未派发 slot 不制造 Attempt 或 Verdict，并在 Sample 中成为 `not-recorded`。
- **并发限制**：全局与 Experiment 上限分别约束在飞 Attempt；等待并发名额不占资源。首过即停、预算、中断和 fatal scope 只停止尚未派发的 slot，不抢占在飞 Attempt。
- **同根单操作**：Invocation 在规划前独占 Record root；同 root 第二条调用立即得到 `record-root-busy`。不建立逐 Eval 锁、心跳、等待、接管或跨 Invocation 重规划。
- **不同 root**：不同 Record root 可以并行，各自执行完整既定计划。fixture 断言两边不读取、不携入、不写入对方数据，也不自动合并。
- **携带与接受**：planner 只使用 `niceeval.verdict`、`niceeval.eligibility`、identity/duration domain 和本次 `--rerun` / `--keep-sandbox` policy。满足条件写 `carried` 或 `accepted` Member；其它状态执行并给具名原因。
- **发布边界**：fresh Attempt 的核心、channels 与 blobs 先在 writer 临时目录完成，再一次发布；随后写 Member 和 Run-owned channel，最后补 `completedAt`。正式 Attempt 不做原地更新。
- **generic fact**：Agent 生命周期写 Attempt-owned custom fact，Experiment/Sandbox 生命周期写 Run-owned custom fact。同 owner/name 只允许一次写入；任意 JsonValue 与 65,536-byte 拒绝语义由 Record owner 验收，Runner 只证明路由到正确 owner。
- **外部状态租约**：相同 `sharedState.key` 串行外部 checkpoint。等待方不创建 Sandbox；释放后继续自己的既定计划，不重读另一 Record 或重做 carry plan。不同 key 可并行。
- **生命周期**：进入 setup 调用点就尝试对应 teardown。Sandbox、Agent runtime、作者 cleanup 与 Provider finalizer 分别按 owner 收尾；单个收尾失败不跳过后续 finalizer。
- **receipt 与 live feedback**：InvocationReceipt 只含 invocation identity、Run identities、起止时间与 completion。进程内 progress 不进入 Record；需要长期回顾的 diagnostic 与业务事实写入 owner-local channel。

## 不这样测

- 不恢复 Member、channel entry、channel event、Graph、revision、session index、Eval 锁或 heartbeat fixture。
- 不用等待真实时间证明并发、重试、租约或 timeout。
- 不把 runner fake 写成第二个 Record writer；只观察公开 writer 调用顺序和结果。
- 不新增自动化只为锁定内部函数形状。无法稳定证明公开行为时，按测试总纲做本次 AI 真实验收。
