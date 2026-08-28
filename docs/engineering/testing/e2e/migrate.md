## OS-user Service state

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Run 的内部持久边界](../../../feature/run/lifecycle.md#删除与-retention)

`state-journey.test.ts` 是安装后 `niceeval state migrate --all` 的最小长期 owner。
它以隔离 `NICEEVAL_HOME` 执行两次同一公开命令，证明初始化成功且重复执行仍成功。
唯一形成的 user durable SQLite 文件是 `${NICEEVAL_HOME}/niceeval.sqlite`，不会形成 project Record。

各第一方 repository 的读写、并发、恢复与资源终结继续由真实消费它们的 lifecycle/cache E2E 拥有。
本 owner 不导入安装包私有模块，不读取 migration ledger 或 SQLite schema，不人工改写内部中间态。

重跑这个 owner：

```sh
pnpm e2e test --repo migrate -- --run test/state-journey.test.ts
```
