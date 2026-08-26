## OS-user Service state

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Record：SQLite 中的已封口运行事实](../../../feature/record/README.md)

`state-journey.test.ts` 是安装后 `niceeval/state` 与 `niceeval state migrate --all` 的最小长期 owner。
它定义一个 checked-in 静态 Service module：namespace migration 含 table/index，三个 fixed put/get/list
operation 都有绑定值与 typed row decoder。两个独立 Node process 以同一个隔离 `NICEEVAL_HOME` 并发首次
open/migrate，各自短写再读；后续 process list 的结果证明 Scope 关闭后的 durable boundary。

未声明 operation 与非法 module schema 都必须 fail closed。调用者不取得 SQL、connection 或 SQLite 内容。
最后从安装后的 CLI 运行 `niceeval state migrate --all`；唯一形成的 user durable 文件是
`${NICEEVAL_HOME}/state.sqlite`，不会形成 project Record 或 cache。

重跑这个 owner：

```sh
pnpm e2e test --repo migrate -- --run test/state-journey.test.ts
```
