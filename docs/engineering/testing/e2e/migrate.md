# SQLite Record collection and portable snapshot

`e2e/migrate/` 是 Record 的安装后 Library → CLI Journey。它不拥有旧版格式、目录布局、私有 SQLite schema 或 maintenance migration 的兼容性矩阵；这些不是新的用户写入与分享结果。

## SQLite Record collection and portable snapshot

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [多次 send 怎样收集 Attempt 事实](../../../feature/record/use-case/多次send怎样收集Attempt事实.md)

`record-journey.test.ts` 用安装后的 `niceeval/record` 定义 `Record.attemptCollection()`，在一个 Attempt 中先 `append`，再以 `appendAll(Stream)` 接纳两个 item，并显式 `close({ state: "complete" })`。它在 append 后修改原输入，再以 `attempt.complete()` 与 `run.seal()` 发布 Run。

同一公开 Host read session 的 bounded `read()` 与 `openCollection()` Stream 都必须按 admission order 读回三个 immutable item，并报告 complete collection。测试不读取 SQLite table、row、page、WAL 或文件内容。

随后它运行安装后的 `niceeval record snapshot --output <path>`，并只让后续 `niceeval query run --record` 接受这个 Snapshot。对 operational `record.sqlite` 的普通文件 copy 必须拒绝为 `--record` 输入；复制动作只制造用户可能误用的输入，测试不解释或断言其私有 bytes。
