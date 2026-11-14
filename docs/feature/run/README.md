# Run：持续发布的评测运行

Run 是 NiceEval 管理的运行资源。Runner 为一次选中的 Experiment 创建一个 Run，并在创建事务中冻结
`runId`、`invocationId`、Experiment identity、开始时间与全部 expected Planned attempts。Run 创建后立即可以由
`niceeval run list` 发现，不等待全部 Attempt 结束。

每个 Attempt 是独立、不可变的运行事实。Attempt 完成自己的写入与验证后，通过一次原子 publication transaction
同时发布 Attempt closure、publication identity 与 origin Planned attempt binding。事务提交后，该 Attempt 即可查询、比较、
沿用或显式采用；origin Run 仍为 `active`、之后中断或失败都不撤销这份事实。

Run 状态是闭集：

- `active`：仍允许当前 writer generation 发布新的 Planned attempt binding；
- `recovering`：恢复已经开始、尚未收口；只在 recover 途中出现，被打断时停留在这里，由下一次 recover 继续；
- `completed`：运行按策略收口；
- `interrupted`：运行在用户中断或已证明 owner 终止后收口；
- `failed`：运行因无法继续的执行或收尾错误收口。

三个终态只说明 Run 不会再增加成员，不决定已有 Attempt 是否可见。终态 Run 永久拒绝新的 Attempt publication
与 reference binding。Run 不因“未完成”而被删除；没有 Attempt 的 Planned attempt 由 `pending` 或终态
`absenceReason` 如实解释；这就是 Run absence，不代表遗失 Attempt。

项目内的 `.niceeval/record.sqlite` 是唯一 ProjectDatabase。它在 Invocation 收尾的 portable gate 通过后可复制、归档和搬运。

Run create、未发布 aggregate、已发布 Attempt、case lock、Invocation Session 与 recovery state 都是这一份 SQLite 的 rows。
公开可见性只由 transaction、writer generation、publication revision 与 reader predicate 决定。
不为 Run、Attempt、锁或 Session 建立 sidecar、逐文件锁或另一份数据库。SQLite 表、事务、WAL、row state 与 generation 是内部实现，不是受支持扩展面。

受控 Invocation 收尾在交付成功前取得 project-wide portable gate；它完整拒绝仍在活动的工作，绝不替其它 Invocation 收口或清除其 rows。
Host 关闭 writer、checkpoint、truncate WAL，再以内建只读路径重开 canonical Record，验证新 baseline 与领域不变量。
新 baseline 强制 `secure_delete=ON`。只有物理删除与 hostile reopen 都通过，命令才交付同一个可移动文件。

Record 只有存储本身的一个格式标记。打开时先核对标记，再建立 reader 或 writer。
旧版 NiceEval 写入的 Record 明确拒绝，提示重跑或删除该存储，原件保持不变。
格式准入与安全条件见 [格式准入](architecture/README.md#格式准入)。

## 用户路径

- 查看结果：[查看运行](use-case/查看运行.md)、[应用中列出运行](use-case/应用中列出运行.md)。
- 管理运行：[恢复中断运行](use-case/恢复中断运行.md)、[删除终态运行](use-case/删除终态运行.md)。
- 按命令或 API 选择：[用户路径索引](use-case/README.md)。

## 入口

- [Library](library.md) —— 高层 `runHost` 组合能力。
- [CLI](cli.md) —— `run list/show/delete/recover`。
- [Architecture](architecture/README.md) —— 身份、publication、cutoff、引用与删除不变量。
- [Lifecycle](architecture/lifecycle.md) —— 创建、发布、收口、崩溃恢复与物理回收顺序。
