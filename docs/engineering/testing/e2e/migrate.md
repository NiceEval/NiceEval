# Persisted Record handoff

`e2e/migrate/` 承载 producer 写入的 opaque Record，供另一个进程中的 candidate 通过安装后的
`niceeval migrate`、`show`、`clean` 与 Report 入口读取。该 Repo 归属 Record 域，不把目录布局变成
普通用户或测试作者 API，也不取代公开 Record API owner。

current root identity 固定为 `niceeval.record.source-receipts`。旧 `niceeval.record` aggregate 是独立的
beta legacy format。它没有把 aggregate Observability 拆成 source receipts 所需的 capture authority 与
segment provenance，因此 current 不自动转换它。

## Current-to-current handoff bootstrap

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [发布完整运行](../../../feature/record/use-case/发布完整运行.md)

`current-handoff.test.ts` 把 `producer` 和 `candidate` 绑定为两个独立的当前命令身份。producer 运行确定性
Experiment 并持久化 source-first Record；candidate 随后以独立 `migrate` 证明它 already-current，再以
`show --run ... --json` 选中 producer 公开交付的同一 Run。

该 owner 只证明可替换 producer 的持久化交接，不声称旧版兼容或格式转换。fixture、expected 与 candidate
均不从 Record 私有文件反推结果。

## npm 0.13.0 beta cutover

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [未来功能不扩张核心格式](../../../feature/record/use-case/未来功能不扩张核心格式.md)

`from-0-13-0.test.ts` 固定并 attest npm `niceeval@0.13.0` 及签入的 registry SRI。它由真实 CLI 运行确定性
Experiment，产生 `niceeval.record` aggregate。current candidate 的 `migrate` 与 `show` 都必须明确返回
`unsupported-format`，不形成 selection，也不报告 automatic migration。旧 conversation、usage、timing、
diagnostics 或 source-navigation 都不能被猜成新的 source receipts。

这个 owner 使用真实旧 producer，不以手写 fixture 冒充 registry 版本。若未来支持另一种已发布 legacy
format，应由独立 attested producer 与独立 owner 定义；不能把 0.13.0 aggregate 改写成有 provenance 的输入。

## Source-first maintenance fixture

`fixtures/source-first-assertions-v1-record/` 是审查过的 literal fixture。它包含 source-first root、current
Core、Seal manifest、Assertions v1 envelope/payload、待迁移丢弃的 own blob，以及一份 schema-invalid 的
Agent Turns source。manifest 对 Core、Attachment 与 source inventory 闭合；fixture 不在 test runtime 通过
candidate 生成 expected。

这份 fixture 同时固定两个边界。Assertions 的 package-owned `1 → 2` 相邻迁移仍可执行。无效 Agent Turns
只使该 source 为 `invalid`，不能把 Assertions migration、Run selection 或其它公开读面污染成整份 Record
invalid。迁移必须同步维护 Seal manifest，并逐字保留不属于目标 family 的 inventory。它不得删除无效 source、
把它伪装成 `not-recorded`，或从旧 aggregate 补造其它 source。

`fixtures/source-first-assertions-future-record/` 是独立 literal closure。它只把已知 Assertions family 固定为
future schemaVersion，用于区分 `unsupported-format` 与 payload/schema invalid；测试不在运行时改写 envelope
再由 candidate 生成自己的 manifest expected。

`fixtures/source-first-unknown-family-record/` 则保存一个 manifest 与目录都闭合、但当前 catalog 不认识的
`niceeval.energy` family。公开 `migrate` 与 `show` 必须在 Core reconstruction 前返回 `unsupported-format`；
不能把未来 writer 的合法扩展误报为 `record-bootstrap-invalid`，也不能形成 selection。

## Assertions v1 to v2

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [显式迁移Record-major](../../../feature/record/use-case/显式迁移Record-major.md)

`assertions-v1.test.ts` 经公开 `niceeval migrate --yes` 与 `show` 证明 Assertions v1 形成 current Assertions 事实。
display、可证明 decision/policy/contribution 与 source sites 按声明保留；criterion、subject、evidence 与旧
diagnostic 不可证明，因此丢弃并给出 rerun 建议。required-unavailable gate 迁移后仍公开显示为 errored。

该 owner 的产品结果只从 CLI `show` 读取。它仅在同一文件保留一个窄的物理 rewrite 例外：核对 root identity
bytes 未变、Assertions envelope/payload 已成为 v2，以及被声明丢弃的 own blob 已移除。它不扫描或断言
Observability/source-navigation 私有布局。

## Interrupted migration recovery

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [显式迁移Record-major](../../../feature/record/use-case/显式迁移Record-major.md)

`interrupted-recovery.test.ts` 证明 source-first Assertions rewrite 的 sentinel 恢复、Git-safe 验证、清除与重试。
缺少 physical write set 的旧 sentinel 只能进入人工恢复。current sentinel 必须绑定 Assertions envelope、payload、
removed blob 与受影响 Seal manifest。只有 dirty paths 精确匹配这组 bytes 时，CLI 才输出限定到 Record root 的
restore 命令。

## Plan change preserves concurrent edit

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [显式迁移Record-major](../../../feature/record/use-case/显式迁移Record-major.md)

`stale-plan.test.ts` 证明第二次 Git preflight 发现 source-first root 并发编辑时返回
`record-migration-plan-stale`，保留编辑且不输出旧计划的恢复命令。

## Migration no-follow replace

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [显式迁移Record-major](../../../feature/record/use-case/显式迁移Record-major.md)

`symlink-race.test.ts` 在最终 source 校验后，把 Assertions envelope 换成指向 Record 外文件的 symlink。
owner 证明 migration fail closed、外部文件 bytes 不变，并进入 recovery-required。写入不能 follow raced symlink。

## Pre-write invalid Record

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [显式迁移Record-major](../../../feature/record/use-case/显式迁移Record-major.md)

`prewrite-invalid.test.ts` 从 source-first fixture 制造 sealed Core 缺失 Member。candidate 必须在首个 portable
write 前返回 `record-migration-invalid`，不输出 restore command，并保持 Git-visible Record 状态不变。

## Future or unknown family

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [未来功能不扩张核心格式](../../../feature/record/use-case/未来功能不扩张核心格式.md)

`future-version.test.ts` 使用 closed literal future fixture。它分别经公开 `migrate` 与 `show` 证明 known family
的 future schemaVersion 与 unknown future family 都返回 `unsupported-format`，不误报 migration/Core invalid，
也不形成 selection。

## Strict complete marker clean

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [record](../../../feature/record/README.md)

`complete-marker-clean.test.ts` 从 source-first Record 起步，经公开 `niceeval clean` 证明只有零字节普通文件
`complete` 能参与 sealed Run；非空文件或同名目录保持 incomplete，并在确认后删除。第二次公开 `clean` 不再列出
这些 Run。

## Report migration metric guard

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [核对数据完整度](../../../feature/reports/use-case/核对数据完整度.md)

`report-guard.test.ts` 用 current candidate 的真实 `exp` 生成 source-first Record，再证明 Report 拒绝 ledger
缺少 denominator Slot 的伪造 metric；它不以 legacy Record 的前置失败掩盖 Report 边界。

## Retired owners

旧 Observability aggregate label preservation 与 `niceeval.source-navigation` cross-family migration owner 已删除。
它们只能证明已撤销的 aggregate `1 → 2` / source-navigation migration，并会制造 source provenance。对应的
cost/tokens/source-navigation Report support 与 missing-usage Experiment 也不再属于本 Repo。
