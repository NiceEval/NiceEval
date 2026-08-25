## SQLite Record collection and portable snapshot

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [多次 send 怎样收集 Attempt 事实](../../../feature/record/use-case/多次send怎样收集Attempt事实.md)

`e2e/migrate/` 是 Record 的安装后 Library → CLI Journey。它不拥有旧版格式、
目录布局、私有 SQLite schema 或 maintenance migration 的兼容性矩阵；这些不是新的用户写入
与分享结果。

`record-journey.test.ts` 用安装后的 `niceeval/record` 同时定义 `Record.run()`、`Record.attempt()` 与
`Record.attemptCollection()`。

Run 和 Attempt 通过 owner-scoped `records.write()` 各写一个 rich value。
collection 先 `append`，再以 `appendAll(Stream)` 接纳两个 item，并显式 `close({ state: "complete" })`。

测试在 append 后修改原输入，再以 `attempt.complete()` 与 `run.seal()` 发布 Run。另一个已 append
但未 close 的 collection 必须让 Attempt completion 以 `record-collection-not-closed` fail closed。

同一公开 Host read session 的 bounded `read()` 读回两个 rich value 与完整 collection；
`openCollection()` Stream 按 admission order 读回三个 immutable item，并报告 complete collection。
文件系统只用于核对公开文件边界：唯一 operational database 是
`.niceeval/record/record.sqlite`，不再发布旧 `runs/` 或 `content/` 目录。测试不读取 SQLite table、row、page、WAL 或文件内容。

同一 owner 还由独立、安装后 Node Host 接纳 50,000 个 `appendAll(Stream)` item 和一个由固定小 chunk
生成的 144 MiB `RecordBytesContentSchema`。它只以 collection count、独立 SHA-256、首尾 identity、
Content `byteLength` 与 paged `stream` 验收；大 collection 与 Content 的 whole-value read 必须在分配前
fail closed。

测试以 96 MiB old-space 和 8 MiB semi-space 启动安装后 Host 子进程。Host 在整个 workload lifecycle
以有界 10ms interval 采样 `process.memoryUsage().rss`，并输出绝对 `peakRss` 与阶段样本。
`peakRss` 必须低于 256 MiB；这证明实现能在明确的受限 heap 下完成，不承诺控制调用方已有内存。
该门槛不包含 Vitest / tsx 所在进程。Node 的同步
区间不会被 timer 切开成额外样本，故此门槛报告该 process 在 event-loop sampling 下观测到的绝对 peak，而不是用
阶段终点样本冒充 peak。

另一个安装后 Host 会分别停在 `run.seal()` 前和 seal receipt 后的明确握手点，让 owner 发送 `SIGKILL`。
重启后的公开 snapshot 与 `niceeval query run` 只能分别看到零个 Run 和完整 sealed Run；测试不从 SQLite、
WAL 或 bytes 推断恢复结果。

随后它运行安装后的 `niceeval record snapshot --output <path>`，并只让后续
`niceeval query run --record` 接受这个 Snapshot。对 operational `record.sqlite` 的普通文件
copy 必须拒绝为 `--record` 输入；复制动作只制造用户可能误用的输入，测试不解释或断言
其私有 bytes。

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

重跑这两个 owner：

```sh
pnpm e2e test --repo migrate -- --run test/record-journey.test.ts test/state-journey.test.ts
```
