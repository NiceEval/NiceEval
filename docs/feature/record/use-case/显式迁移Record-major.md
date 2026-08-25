---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 显式 migration 与 Snapshot 边界

用户遇到 predecessor storage revision 或 family revision 时显式运行 maintenance。ordinary `query`、`view`、`exp` 与 Library
read 不自动 migrate，也不把 operational database 当作可回滚文件。

## 两条 migration chain

| change | mechanism | logical result |
|---|---|---|
| table、index、trigger、storage revision | checked-in adjacent SQL | 保留 `LogicalSealIdentity`，推进 storage generation |
| family payload、items、Content、references | typed adjacent converter | 推进 family revision，重建 closure 与 Seal |

Host 使用 `node:sqlite`、fixed prepared statements 与 typed decoder；不生成 SQL、不运行 Drizzle。unknown family 使用 generic rows
原样搬运，physical migration 不调用它的 Schema。family/data migration 只有拿到对应 definition 才能解释 canonical facts。

ordinary open 发现 supported predecessor 返回 `record-schema-migration-required` 或 `migration-required`；newer/foreign identity 返回
`record-schema-unsupported`。maintenance 取得 exclusive lease并等待 writer/read generation lease 释放。小 metadata change 在
exclusive transaction 中完成；大表 rebuild 或大量 family rewrite 使用 copy-on-write target，验证并 fsync 后才原子替换。

## Git 与 copy

`.niceeval/record/record.sqlite` 是 operational database。即使停稳、checkpoint 或 close，raw copy 也不能证明 free pages 没有
unpublished bytes，因此 Git 不承担它的 migration rollback。

需要保存迁移前后状态时，分别让 Host 生成 sealed-only `RecordSnapshot`。Snapshot barrier 只在固定 source view 时阻止新 write
transaction，随后 target 删除 open/sealing closure并 `VACUUM INTO`，验证 exact Seal 后关闭。只有这种 Snapshot 可以 copy、
Git 或兼容 NiceEval runtime 的 `--record`；Git merge 不合并 SQLite rows。

## Crash 与 retry

SQLite transaction commit 是小 migration 的 durable boundary；copy-on-write source replacement 是大 migration 的 boundary。
崩溃后 Host 从 stable storage generation 与 migration identity 判断 source/target，不依赖 CLI receipt。physical-only migration
必须重验同一 Logical Seal；family migration 只有完整新 closure 与 Seal 都验证后才发布。

外部 Snapshot 恢复同样按 hostile input 导入：关闭 extension/ATTACH，限制资源，核对 exact schema allowlist、typed rows、SQLite
structure 与 Logical Seal。普通 path 或任意 SQLite file 不能冒充 nominal Snapshot。
