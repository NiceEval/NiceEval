## OS-user Service state

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Run 的内部持久边界](../../../feature/run/lifecycle.md#删除与-retention)

`state-journey.test.ts` 是安装后 `niceeval state migrate --all` 的最小长期 owner。
它以隔离 `NICEEVAL_HOME` 执行两次同一公开命令，证明首次返回 `bootstrapped`，重复执行明确
返回 `current` no-op，不用同一条“migrations complete”掩盖两种结果。
唯一形成的 user durable SQLite 文件是 `${NICEEVAL_HOME}/niceeval.sqlite`，不会形成 project Record。

UserDatabase 的 migration catalog 以全局连续 version 管理完整 application schema，不按 Repository 各自推进版本。
每个新 version 必须由上一正式发布的安装包经公开入口生成 predecessor fixture，再由当前 candidate
通过同一 `state migrate --all` 入口证明 inspect、apply、reopen/validate 与稳定错误反馈。不手工构造
SQLite schema 来代替 predecessor。

各第一方 repository 的读写、并发、恢复与资源终结继续由真实消费它们的 lifecycle/cache E2E 拥有。
本 owner 不导入安装包私有模块，不读取 migration ledger 或 SQLite schema，不人工改写内部中间态。

重跑这个 owner：

```sh
pnpm e2e test --repo migrate -- --run test/state-journey.test.ts
```
