## SQLite Record collection, bounded streaming, and portable snapshot

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Attempt publication](../../../feature/run/architecture.md#attempt-publication)

此标题只保留既有测试 owner anchor；它不声明公开产品能力。本 owner 的当前心智是 Run publication 与内部 SQLite adapter。

`e2e/record/` 是待迁移到 Run 心智的历史测试路径；路径名不构成公开产品概念。长期结果 owner 是安装后
Library → CLI Journey：Run create 后立即可以由 `run list` 发现，每个 Attempt 独立发布，Run 收口只冻结终态和
剩余 slot 的 absence reason。

Journey 通过正式 Experiment 入口创建 Run，并从 `run list`、`run show` 与固定 Inspection operation 观察：

- create transaction 同时冻结 expected slots、invocationId 与 writer generation；
- Attempt closure、publication identity 与 origin binding 同一事务提交，提交前不可见，提交后完整可见；
- 已发布 Attempt 不等待 origin Run 收口即可被精确引用，origin 后续中断不撤销它；
- Run close 与剩余 absence reasons 使用同一 revision，终态拒绝新的 binding；
- 所有读取固定同一个 PublicationCutoff，不混入较晚 create、binding、close 或 deletion。

SQLite schema、migration、generation retention、checkpoint、snapshot 与物理回收只作为内部 adapter 的故障边界。
测试不得导入内部 reader/writer、提交 SQL 或文件路径，也不得把物理数据库副本当作公开输入。

验证命令：

```sh
pnpm e2e test --repo record -- --run test/record-journey.test.ts
```

在测试实现完成 Run 契约迁移前，本页只声明长期 owner，不把旧公开持久 API 的现状提升为目标契约。
