## Run create, Attempt publication, interruption, and lifecycle

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Attempt publication](../../../feature/run/architecture.md#attempt-publication)

`e2e/record/` 的路径名是历史测试域标识，不构成公开产品概念。`record-journey.test.ts` 是安装后
Experiment → Run CLI → Inspection Journey：Run create 后立即可以由 `run list` 发现，每个 Attempt 独立发布，
Run 收口只冻结终态和剩余 slot 的 absence reason。

Journey 通过正式 Experiment 入口创建 Run，并从 `run list`、`run show` 与固定 Inspection operation 观察：

- create transaction 同时冻结 expected slots、invocationId 与 writer generation；
- Attempt closure、publication identity 与 origin binding 同一事务提交，提交前不可见，提交后完整可见；
- 已发布 Attempt 不等待 origin Run 收口即可被精确引用，origin 后续中断不撤销它；
- Run close 与剩余 absence reasons 使用同一 revision，终态拒绝新的 binding；
- SIGKILL 后的 active Run 只有在 `run recover` 证明旧 owner 已终止后才能收口；
- incoming reference 存在时 `run delete` 零删除，依赖 Run 删除后 origin Run 才能删除。

SQLite schema、migration、generation retention、checkpoint、snapshot 与物理回收只作为内部 adapter 的故障边界。
测试不得导入内部 reader/writer、提交 SQL 或文件路径，也不得把物理数据库副本当作公开输入。

验证命令：

```sh
pnpm e2e test --repo record -- --run test/record-journey.test.ts
```

本 owner 不检查 SQLite schema、文件布局、snapshot 或物理回收；这些内部 adapter 细节不能成为公开 Journey 的输入或 expected。
