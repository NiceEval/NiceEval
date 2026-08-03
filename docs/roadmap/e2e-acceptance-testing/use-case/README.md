# NiceEval 测试体系重构 —— Use Cases

这里展示工程维护者怎样把真实用户路径登记为 Recipe、Behavior 和执行门禁。
架构单源在 [Architecture](../architecture.md)，Behavior 声明单源在
[PLAN-2](../../../design/user-readable-testing/PLAN-2/README.md)，领域断言单源在
[E2E 验收 DSL](../../e2e-acceptance-dsl/README.md)。

- [Report target 闭环](report-target-closure.md) —— 用确定性 Record、真实静态导出、HTTP 与 Chromium 覆盖 attempt、experiment 和自定义参数化页。
- [真实进程与机器出口](process-and-machine-output.md) —— 同时证明 pipe、JSON/JUnit 结构与最终 exit 折叠。
- [Show 证据切片完整往返](evidence-slices-roundtrip.md) —— 从安装后的真实 CLI 依次读回 source、execution、timing 与 diff，并登记精确源码触发路径。
- [Attempt 执行证据 Web 闭环](attempt-execution-evidence.md) —— 同时具有 source 与 events 时，独立文档和宿主 dialog 都保留 Conversation；缺 events 时显示明确 warning。
- [候选包消费方矩阵](package-consumer-matrix.md) —— 一次 prepare 生成三种外部项目，Behavior 只读并可独立重跑。
- [时间线并发关系](timeline-concurrency.md) —— 用事件偏序证明实验闸与重试持闸，不比较墙钟阈值。
- [可变 view 与资源收尾](mutable-view-and-cleanup.md) —— 私有 clone、长驻 service、动态端口与无条件 cleanup 的完整路径。
- [Carried 测试组合迁移](carried-proof-migration.md) —— 把重复 fingerprint / human / JSON / record 测试收敛为一个用户主证明、唯一机制矩阵与少量边界 proof。
