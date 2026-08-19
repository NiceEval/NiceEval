# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 Record，供另一个进程中的 candidate 通过公开 CLI 读取。
该 Repo 归属 Record 域，但不取代公开 Record API owner。

## Observability v1 to v2

`e2e/migrate/test/handoff.test.ts` 是显式 family migration 的单边界 owner。它把签入的 literal
Observability v1 Record 复制到隔离消费项目，从安装后的 candidate 依次执行公开 `show` 与
`niceeval migrate`：

- migration 前 `show --json` 返回 `analysis-migration-required`，不误读旧 bytes；
- 没有 `--yes` 时只打印包含两个 attachment 的计划，dirty portable root 即使带 `--yes` 也拒绝；
- clean Git restore point 下迁移成功，两个 envelope 变成 v2，payload、未知 family 与 draft bytes 不变；
- migration 后同一 Run 可由 `show` 读取，再次运行得到 `already-current`；
- sentinel 存在时公开命令返回 `record-migration-interrupted`。
- sealed Core 缺失 Member 时在 sentinel 写入前返回 `record-migration-invalid`，不留下混合版本。

fixture 的 root schemaVersion 与两个 Observability schemaVersion 都是独立字面量，不由 candidate
生成 expected。它只验收 Record root v1 内的 Observability family 1→2，不把旧 `niceeval.results`
或未来 Record root major 宣称为可迁移输入。
