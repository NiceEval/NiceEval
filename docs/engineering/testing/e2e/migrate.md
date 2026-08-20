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

`e2e/migrate/test/handoff.test.ts` 是显式 family migration 的成功 Journey owner。它把签入的 literal
Observability v1 Record 复制到隔离消费项目，从安装后的 candidate 依次执行公开 `show` 与
`niceeval migrate`：

- migration 前 `show --json` 返回 `analysis-migration-required`，不误读旧 bytes；
- 没有 `--yes` 时只打印包含两个 attachment 的计划；
- clean Git restore point 下迁移成功，两个 envelope 变成 v2，payload、未知 family 与 draft bytes 不变；
- migration-required 与普通 missing 混合时 Report 保持 `partial`，不输出错误的迁移恢复动作；
- migration 后同一 Run 可由 `show` 读取，再次运行得到 `already-current`；

其它独立输入与修复动作各自由一个最小 owner 负责。

### Interrupted migration recovery

`interrupted-recovery.test.ts` 证明 sentinel 恢复、验证、清除与重试。

### Plan change preserves concurrent edit

`stale-plan.test.ts` 证明第二次规划发现并发编辑时保留编辑，且不输出破坏性恢复命令。

### Migration no-follow replace

`symlink-race.test.ts` 在最终 source 校验后把目标 envelope 换成指向 Record 外文件的 symlink，
证明 migration fail closed、外部文件 bytes 不变，并保留 sentinel 进入人工恢复。

### Pre-write invalid Record

`prewrite-invalid.test.ts` 证明 sealed Core invalid 在首个 portable write 前拒绝且无 sentinel。

### Post-write invalid Record

`postwrite-invalid.test.ts` 证明 SourceNavigation join 在写入后 fail closed，返回 recovery-required 并保留 sentinel。

### Future known family

`future-version.test.ts` 证明 known family future version 返回 unsupported，不误报 invalid。

### Historical v1 labels

`historical-labels.test.ts` 证明 v1 合法 `turn01` 与大整数字符串 label 逐字迁移。

### Strict complete marker clean

`complete-marker-clean.test.ts` 通过公开 `niceeval clean` 证明只有零字节普通文件
`complete` 会封口 Run；非空文件或同名目录保持 incomplete，并在确认后被删除。

### Report migration metric guard

`report-guard.test.ts` 证明 Report 拒绝 ledger 缺少 denominator Slot 的伪造 migration-required metric；成功 Journey 同时证明非零全迁移状态保留。

fixture 的 root schemaVersion 与两个 Observability schemaVersion 都是独立字面量，不由 candidate
生成 expected。它只验收 Record root v1 内的 Observability family 1→2，不把旧 `niceeval.results`
或未来 Record root major 宣称为可迁移输入。
