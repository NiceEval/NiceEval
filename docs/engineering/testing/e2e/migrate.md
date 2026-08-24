# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 opaque Record，供另一个进程中的 candidate 通过安装后的
`niceeval migrate`、`show`、`clean` 与 Report 入口读取。它也从安装后的 `niceeval/record` 验证公开
Attachment composition。该 Repo 归属 Record 域，不把目录布局变成普通用户或测试作者 API。

## Third-party Attachment family composition

`third-party-family.test.ts` 从安装后的 `niceeval/record` 定义两个 Run-owned current logical family。
每个 family 用 `defineRecordAttachmentPersistence` 绑定 exact definition brand、revision 与 private chain。
writer Host 组合两项 persistence；reader Host 只贡献其中一项。

已贡献 family 仍可局部读回。直接读取未贡献 family 返回 `family-definition-required`，
`requireComplete()` 也 fail closed。这个 owner 证明第三方 persistence 不依赖全局 registry，且无关未知
inventory 不阻塞局部读取或被完整操作当作成功。

current root identity 固定为 `niceeval.record.attachments`。`niceeval.record.source-receipts` 是本 Repo 验证的
受支持 predecessor；更早的 `niceeval.record` aggregate 是独立 beta legacy format，不进入这条 migration。

## Current-to-current handoff bootstrap

`current-handoff.test.ts` 把 `producer` 和 `candidate` 绑定为两个独立的当前命令身份。producer 运行确定性
Experiment 并持久化 source-first Record；candidate 随后以独立 `migrate` 证明它 already-current，再以
`show --run ... --json` 选中 producer 公开交付的同一 Run。

该 owner 只证明可替换 producer 的持久化交接，不声称旧版兼容或格式转换。fixture、expected 与 candidate
均不从 Record 私有文件反推结果。

## npm 0.13.0 beta cutover

`from-0-13-0.test.ts` 固定并 attest npm `niceeval@0.13.0` 及签入的 registry SRI。它由真实 CLI 运行确定性
Experiment，产生 `niceeval.record` aggregate。current candidate 的 `migrate` 与 `show` 都必须明确返回
`unsupported-format`，不形成 selection，也不报告 automatic migration。旧 conversation、usage、timing、
diagnostics 或 source-navigation 都不能被猜成新的 source receipts。

这个 owner 使用真实旧 producer，不以手写 fixture 冒充 registry 版本。若未来支持另一种已发布 legacy
format，应由独立 attested producer 与独立 owner 定义；不能把 0.13.0 aggregate 改写成有 provenance 的输入。

## Source-first maintenance fixture

`fixtures/source-first-assertions-v1-record/` 是审查过的 literal fixture。它包含 source-first root、current
Core、Seal manifest、Assertions revision 1 envelope/payload，以及待迁移丢弃的 own content。manifest 对 Core
与 Attachment physical closure 闭合；fixture 不在 test runtime 通过 candidate 生成 expected。

这份 fixture 固定 Assertions persistence 的 package-owned `1 → 2 → 3` 相邻迁移，且 revision 2 只在内存流转。
迁移必须同步重建 Seal manifest 与 content closure，不得把被明确丢弃的 revision 1 material 伪装成 current fact，
也不得从旧 aggregate 补造其它 source。

`fixtures/source-first-assertions-future-record/` 是独立 literal closure。它只把已知 Assertions persistence 固定为
future revision，用于区分 `unsupported-format` 与 payload/schema invalid；测试不在运行时改写 envelope
再由 candidate 生成自己的 manifest expected。

`fixtures/source-first-unknown-family-record/` 则保存一个 manifest 与目录都闭合、但当前 catalog 不认识的
`niceeval.energy` family。公开 `migrate` 与 `show` 必须在 Core reconstruction 前返回 `unsupported-format`；
不能把未来 writer 的合法扩展误报为 `record-bootstrap-invalid`，也不能形成 selection。

## Assertions v1 to current

`assertions-v1.test.ts` 经公开 `niceeval migrate --yes` 与 `show` 证明 Assertions v1 经过内存中的 revision 2 形成 current revision 3 Assertions 事实。
display、可证明 decision/policy/contribution 与 source sites 按声明保留；criterion、subject、evidence 与旧
diagnostic 不可证明，因此丢弃并给出 rerun 建议。required-unavailable gate 迁移后仍公开显示为 errored。

该 owner 的产品结果只从 CLI `show` 读取。它不扫描或断言 Attachment、Observability 或 source-navigation
私有布局；第二次公开 migration 的 `already-current` 结果证明操作可续跑。

## Interrupted migration recovery

`interrupted-recovery.test.ts` 从安装后的 Library 打开真实 maintenance session，等待它取得 lease 后用 `SIGKILL`
终止进程。下一次公开 `niceeval migrate --yes` 必须识别 dead same-host owner、恢复 maintenance 并完成迁移；
随后 `show` 能读取结果。owner 不使用 sentinel、Git shim 或伪造 lock fixture。

## Plan change preserves concurrent edit

`stale-plan.test.ts` 先从安装后的 Library 取得 nominal migration plan，再由独立 CLI process 提交 migration。
旧 plan 的 `applyMigrate()` 必须返回 `record-migration-plan-stale`，不能重复应用已失效的 source-byte plan。

## Migration no-follow replace

`symlink-race.test.ts` 把 Assertions envelope 换成指向 Record 外文件的 symlink。公开 migration 必须以
`record-path-type-invalid` fail closed，并保持外部文件 bytes 不变。写入不能 follow symlink。

## Pre-write invalid Record

`prewrite-invalid.test.ts` 从 predecessor fixture 制造 sealed Core 缺失 Member。candidate 必须在首个 portable
write 前返回 `record-migration-invalid`，并保持整个 Record tree digest 不变。owner 不依赖 Git repository。

## Future or unknown family

`future-version.test.ts` 使用 closed literal future fixture。known family 的 future revision 让 migration
返回 `record-format-unsupported`；ordinary `show` 仍先要求 root migration。unknown future family 则让 migration
返回 `family-definition-required`，证明 maintenance 不会从目录名猜 definition，也不误报 Core invalid。

## Strict complete marker clean

`complete-marker-clean.test.ts` 从 source-first Record 起步，经公开 `niceeval clean` 证明只有零字节普通文件
`complete` 能参与 sealed Run；非空文件或同名目录保持 incomplete，并在确认后删除。第二次公开 `clean` 不再列出
这些 Run。

## Report migration metric guard

`report-guard.test.ts` 用 current candidate 的真实 `exp` 生成 source-first Record，再证明 Report 拒绝 ledger
缺少 denominator Slot 的伪造 metric；它不以 legacy Record 的前置失败掩盖 Report 边界。

## Retired owners

旧 Observability aggregate label preservation 与 `niceeval.source-navigation` cross-family migration owner 已删除。
它们只能证明已撤销的 aggregate `1 → 2` / source-navigation migration，并会制造 source provenance。对应的
cost/tokens/source-navigation Report support 与 missing-usage Experiment 也不再属于本 Repo。
