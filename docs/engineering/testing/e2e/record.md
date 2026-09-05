## Run create, Attempt publication, interruption, and lifecycle

<!-- niceeval.e2e-owner-history/v1 action=retired reason="Replaced by five case-specific Run owners." at=ed9186c66cbf8be1ef9c4db28557101f5d9465ad -->
Contract: [Attempt publication](../../../feature/run/architecture.md#attempt-publication)

`e2e/record/` 的路径名是历史测试域标识，不构成公开产品概念。
`record-journey.test.ts` 曾把安装后的 Experiment、Run CLI 与 Inspection 合成一个 Journey。
Run create 后立即可以由 `run list` 发现，每个 Attempt 独立发布。Run 收口只冻结终态和剩余 slot 的 absence reason。

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
## Run 创建后立即可发现，并冻结完整 expected slots。 {#run-create-freezes-expected-slots}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/architecture.md#身份与固定计划](../../../feature/run/architecture.md#身份与固定计划)

Run 创建后立即可发现，并冻结完整 expected slots。
## 已完成 Attempt 不等待 Run 收口即可公开读取。 {#attempt-readable-before-run-close}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/architecture.md#attempt-publication](../../../feature/run/architecture.md#attempt-publication)

已完成 Attempt 不等待 Run 收口即可公开读取。
## 用户 SIGINT 中断时保留已发布 Attempt，并解释未发布 slot。 {#sigint-preserves-published-attempt}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/lifecycle.md#创建与执行](../../../feature/run/lifecycle.md#创建与执行)

用户 SIGINT 中断时保留已发布 Attempt，并解释未发布 slot。
## 存在引用时拒绝删除 origin，删除依赖后允许安全重试。 {#referenced-origin-delete-safety}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/architecture.md#删除不变量](../../../feature/run/architecture.md#删除不变量)

存在引用时拒绝删除 origin，删除依赖后允许安全重试。
## SIGKILL 后自动沿用已发布 Attempt，只执行缺失 slot 并可显式收口旧 Run。 {#sigkill-recovery-closes-run}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/lifecycle.md#崩溃与-recovery](../../../feature/run/lifecycle.md#崩溃与-recovery)

SIGKILL 后的新 Invocation 自动沿用 active Run 中已发布的 Attempt，只执行缺失 slot；用户随后可通过显式 recover 取得恢复 authority，并把旧 Run 收口为 interrupted。
## 独立 Library consumer 可组合 Run 的读取、恢复和删除，并捕获预期 RunReadError。 {#public-run-host-consumer}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/run/README.md](../../../feature/run/README.md)

独立 Library consumer 可组合 Run 的读取、恢复和删除，并捕获预期 RunReadError。
