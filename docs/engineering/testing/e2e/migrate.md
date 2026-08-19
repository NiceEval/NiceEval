# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 Record，供另一个进程中的 candidate 通过公开 CLI 读取。
该 Repo 归属 Record 域，但不取代公开 Record API owner。

## Current-to-current handoff bootstrap

初始 owner 把 `producer` 和 `candidate` 绑定为两个命令身份，但两者都使用当前 candidate。
producer 运行确定性 Experiment 并持久化 Record。candidate 在同一个私有 case 项目中启动独立的
`show --run ... --json` 命令，并必须选中该次公开 Run 身份。

该 owner 只证明持久化交接和可替换的 producer 接缝。它不声称旧版兼容、旧 schema 迁移、
格式转换后的 ID 保留，也不声称已接管 legacy producer 的可靠性。

当可验证的旧包可用时，root runner 负责该包身份，测试只替换 producer 命令前缀。
直接读取仅适用于当前 reader 支持的 Record 版本；更旧的 Record major 仍须经过产品的显式迁移路径。

## Observability v1 to v2

`e2e/migrate/test/handoff.test.ts` 是显式 family migration 的单边界 owner。它把签入的 literal
Observability v1 Record 复制到隔离消费项目，从安装后的 candidate 依次执行公开 `show` 与
`niceeval migrate`：

- migration 前 `show --json` 返回 `analysis-migration-required`，不误读旧 bytes；
- 没有 `--yes` 时只打印包含两个 attachment 的计划，dirty portable root 即使带 `--yes` 也拒绝；
- clean Git restore point 下迁移成功，两个 envelope 变成 v2，payload、未知 family 与 draft bytes 不变；
- migration 后同一 Run 可由 `show` 读取，再次运行得到 `already-current`；
- sentinel 存在时公开命令返回 `record-migration-interrupted`、精确 restore/verify/clear 命令；按顺序恢复后可重试成功。
- sealed Core 缺失 Member 时在 sentinel 写入前返回 `record-migration-invalid`，不留下混合版本。
- 单 family schema 合法但 SourceNavigation join 损坏时，post-write 校验 fail closed 并保留 sentinel。
- known family future version 返回 `unsupported-format` 与 producer-version 提示，不误报损坏。
- v1 合法的 `turn01` 与大整数字符串 label 逐字迁移成功；它们不是原生 v2 writer 的 coordinate。

fixture 的 root schemaVersion 与两个 Observability schemaVersion 都是独立字面量，不由 candidate
生成 expected。它只验收 Record root v1 内的 Observability family 1→2，不把旧 `niceeval.results`
或未来 Record root major 宣称为可迁移输入。
