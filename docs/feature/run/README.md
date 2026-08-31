---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Run：持续发布的评测运行

Run 是 NiceEval 管理的运行资源。Runner 为一次选中的 Experiment 创建一个 Run，并在创建事务中冻结
`runId`、`invocationId`、Experiment identity、开始时间与全部 expected slots。Run 创建后立即可以由
`niceeval run list` 发现，不等待全部 Attempt 结束。

每个 Attempt 是独立、不可变的运行事实。Attempt 完成自己的写入与验证后，通过一次原子 publication transaction
同时发布 Attempt closure、publication identity 与 origin slot binding。事务提交后，该 Attempt 即可查询、比较、
沿用或显式采用；origin Run 仍为 `active`、之后中断或失败都不撤销这份事实。

Run 状态是闭集：

- `active`：仍允许当前 writer generation 发布新的 slot binding；
- `completed`：运行按策略收口；
- `interrupted`：运行在用户中断或已证明 owner 终止后收口；
- `failed`：运行因无法继续的执行或收尾错误收口。

三个终态只说明 Run 不会再增加成员，不决定已有 Attempt 是否可见。终态 Run 永久拒绝新的 Attempt publication
与 reference binding。Run 不因“未完成”而被删除；没有 Attempt 的 slot 由 `pending` 或终态
`absenceReason` 如实解释；这就是 Run absence，不代表遗失 Attempt。

项目内的 `.niceeval/record.sqlite` 是唯一 ProjectDatabase，也是 portable gate 通过后可以复制、归档和搬运的产品 artifact。
Run create、未发布 aggregate、已发布 Attempt 与 recovery state 都在这一个 SQLite。公开可见性只由 transaction、writer
generation、publication revision 与 reader predicate 决定，不为 Run 或 Attempt 创建 staging database。SQLite 表、事务、
WAL、row state 与 generation 是内部实现，不是受支持扩展面。

受控 CLI 退出在交付成功前取得 project-wide portable barrier，并收口 Run、删除未发布 aggregate 与 coordination rows。
Host 关闭 writer、checkpoint、truncate WAL，再以内建只读路径重开 canonical Record，验证新 baseline 与领域不变量。
新 baseline 强制 `secure_delete=ON`。只有物理删除与 hostile reopen 都通过，命令才交付同一个可移动文件。
旧 schema 与无法验证的外部 database 一律 fail closed；用户重新运行产生 current baseline，不提供旧数据转换或副本导出。

## 入口

- [Library](library.md) —— 高层 `runHost` 组合能力。
- [CLI](cli.md) —— `run list/show/delete/recover`。
- [Architecture](architecture.md) —— 身份、publication、cutoff、引用与删除不变量。
- [Lifecycle](lifecycle.md) —— 创建、发布、收口、崩溃恢复与物理回收顺序。
