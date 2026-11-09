# MemoryBench：分组复用记忆条件与 Git seed

契约单源见 [Library](../library.md)、[Architecture](../architecture/README.md) 与
[Lifecycle](../architecture/lifecycle.md)。本页只说明 MemoryBench 的组合方式。

MemoryBench 把同一记忆条件下、物理 Sandbox 计划兼容的 Eval 切成多个 Group。每个 Group 使用一台
Docker Sandbox 串行运行成员；多个 Group 同时占用 Experiment 的并发名额。这样既复用昂贵的
记忆工具与 Agent setup，也不会把整批评估压成一条长串行队列。

仓库准备由 MemoryBench 自己的 Eval Plugin resource 持有，不进入 NiceEval 官方 Plugin：

1. resource `materialize` 为当前物理 Group 建立一次 bare Git seed，并执行唯一一次远端 fetch；
2. 每条真实 Attempt 的 `prepare` 从本地对象库复制需要的对象，再 detached checkout 到题目目录；
3. prepare 不执行 clone、fetch、pull，也不依赖远端 refs、alternates、hooks 或 reflog；
4. resource release 只释放仍存活的宿主资源，不在 Sandbox 销毁后重复执行容器命令。

因此远端 Git 工作量按实际 Group 数增长，不按 Eval 数增长。具体仓库 URL、revision、凭据与
目录规则仍属于 MemoryBench；NiceEval core 只负责 resource lifecycle、Group lane / pool 与调度。

Remem、Obelisk 等固定版本的文档型 Skill 随 MemoryBench vendored，Plugin identity 包含
上游 revision。Agent Extension 使用 `kind: "local"` 上传，不在每条 Attempt 重新 clone。

## 成员结束后保存 checkpoint {#save-checkpoint-after-members}

跨 Attempt 的 Sandbox 文件状态使用 [State](../../state/README.md)，由 Runner 在实例退役时保存。
下列作者自管的外部 checkpoint cleanup 不等于 State；两者的保存条件不能混用。
按 [Lifecycle](../architecture/lifecycle.md) 使用独立收尾预算；不要把最后一条成员的剩余执行时间作为保存命令的预算。

验证时选择一个会耗尽执行时限的成员，再检查收尾诊断和实际保存结果。
成员超时不应让 checkpoint 命令只剩 1ms；作者为命令显式设置的 timeout 仍然有效。
同时检查受控中断路径，确认保存步骤使用收尾阶段的 signal。

保存失败时，分别审阅已发布 Attempt 与收尾诊断。保留成员的真实结果，不把保存失败改写成所有成员失败。
只有保存结果经过核对后，才把它作为后续实验的起点；成员完成本身不能证明 checkpoint 可用。
从固定 Run 核对结果的步骤见[核对数据完整度](../../inspection/use-case/inspection-check-completeness.md#audit-interrupted-run)。
