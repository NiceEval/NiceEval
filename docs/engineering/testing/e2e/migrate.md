## OS-user Service state

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Record：SQLite 中的已封口运行事实](../../../feature/record/README.md)

`state-journey.test.ts` 是安装后 UserDatabase Host 与 `niceeval state migrate --all` 的最小长期 owner。
空路径打开后形成全部第一方最终 schema。两个独立 Node process 以同一个隔离
`NICEEVAL_HOME` 并发首次 open，各自短写再读；后续 process list 的结果证明 Scope 关闭后的 durable boundary。

任一第一方 schema 被替换、allowlist 外对象、空的既有 SQLite 与旧 sidecar 都会让整个 UserDatabase fail closed。
调用者不取得 SQL、connection 或 SQLite 内容。最后从安装后的 CLI 运行 `niceeval state migrate --all`；唯一形成的 user durable 文件是
`${NICEEVAL_HOME}/niceeval.sqlite`，不会形成 project Record 或独立 cache database。

重跑这个 owner：

```sh
pnpm e2e test --repo migrate -- --run test/state-journey.test.ts
```
