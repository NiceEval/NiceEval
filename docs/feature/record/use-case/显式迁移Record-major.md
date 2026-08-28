---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 显式 migration 与 Snapshot 边界

用户遇到 predecessor storage revision 或 family revision 时显式运行 maintenance。ordinary `query`、`view`、`exp` 与 Library
read 不自动 migrate，也不把 operational database 当作可回滚文件。

## 一个数据库级序列

| change | mechanism | logical result |
|---|---|---|
| table、index、trigger、storage revision | 全局编号 physical migration | 保留 `LogicalSealIdentity`，推进 storage generation |
| family payload、items、Content、references | 全局编号 logical-data migration 私有调用 typed converter | 推进受影响行的 family revision，重建 closure 与 Seal |

Record v1 不导入 0.13.x bytes。Host 使用 `node:sqlite`、fixed prepared statements 与 typed decoder；不生成 SQL、不运行 Drizzle。
每个数据库只有一条 checked-in、连续编号的 migration catalog；业务 persistence 只定义最终态，不注册历史链。unknown family 使用 generic rows
逐 byte 保留，physical migration 不调用它的 Schema。logical-data migration 只有拿到对应私有 historical decoder 才能解释 canonical facts。

ordinary open 发现 supported predecessor 返回 `record-schema-migration-required` 或 `migration-required`；newer/foreign identity 返回
`record-schema-unsupported`。maintenance 取得 exclusive lease并等待 writer/read generation lease 释放。小 metadata change 在
exclusive transaction 中完成；大表 rebuild 或大量 family rewrite 使用 copy-on-write target，验证并 fsync 后才原子替换。

## Git 与 copy

`.niceeval/record.sqlite` 是 operational database。即使停稳、checkpoint 或 close，raw copy 也不能证明 free pages 没有
unpublished bytes，因此 Git 不承担它的 migration rollback。

需要保存迁移前后状态时，分别让 Host 生成 sealed-only `RecordSnapshot`。Snapshot barrier 只在固定 source view 时阻止新 write
transaction，随后 target 删除 open/sealing closure并 `VACUUM INTO`，验证 exact Seal 后关闭。只有这种 Snapshot 可以 copy、
Git 或兼容 NiceEval runtime 的 `--record`；Git merge 不合并 SQLite rows。

## Crash 与 retry

每个编号 migration 的转换、postcondition、ledger receipt 与 revision 推进在同一 SQLite transaction 中提交。
maintenance lease 在整条计划期间持续持有。
未来确有大 migration 时才另行定义 copy-on-write boundary。
崩溃后 Host 从 stable storage generation 与 migration identity 判断 source/target，不依赖 CLI receipt。physical-only migration
必须重验同一 Logical Seal；family migration 只有完整新 closure 与 Seal 都验证后才发布。

外部 Snapshot 恢复同样按 hostile input 导入：关闭 extension/ATTACH，限制资源，核对 exact schema allowlist、typed rows、SQLite
structure 与 Logical Seal。普通 path 或任意 SQLite file 不能冒充 nominal Snapshot。
