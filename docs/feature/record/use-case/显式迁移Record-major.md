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
| future v1 family payload、items、Content、references | typed adjacent converter | 推进 family revision，重建 closure 与 Seal |

v1 不导入 0.13.x Record/state/cache bytes，也不提供 converter。Host 使用 `node:sqlite`、fixed prepared statements 与 typed decoder；不生成 SQL、不运行 Drizzle。unknown family 使用 generic rows
原样搬运，physical migration 不调用它的 Schema。family/data migration 只有拿到对应 definition 才能解释 canonical facts。

ordinary open 发现 supported predecessor 返回 `record-schema-migration-required` 或 `migration-required`；newer/foreign identity 返回
`record-schema-unsupported`。maintenance 取得 exclusive lease并等待 writer/read generation lease 释放。小 metadata change 在
exclusive transaction 中完成；大表 rebuild 或大量 family rewrite 使用 copy-on-write target，验证并 fsync 后才原子替换。

## Snapshot 输出案例

用户以 Host 生成一个可交给 Git 或 `--record` 的参照结果时，命令和成功 receipt 如下。receipt 只在 target 已 sealed-only rewrite、
exact Seal 验证、checkpoint 与关闭后出现；它不把 operational source path 或 open/sealing closure 当作结果的一部分。

```text
$ niceeval record snapshot --output ./snapshots/baseline.record-snapshot
Snapshot created
record: ./snapshots/baseline.record-snapshot
status: sealed-only
next: niceeval query discover --record ./snapshots/baseline.record-snapshot
```

若 snapshot barrier、空间 preflight 或 deadline 不能固定一致 source，命令以非零状态结束。不会输出 `Snapshot created`、`record:` 或
可由 `--record` 接受的 target receipt；已有同名文件也不能据此被视为本次成功结果。

```text
$ niceeval record snapshot --output ./snapshots/baseline.record-snapshot
error: record-snapshot-busy
reason: could not form a consistent snapshot before the deadline
next: release writer contention or provide sufficient output space, then retry
```

这个错误只表示没有形成 Snapshot，不表示任何 Run 已 partial；释放 contention 或调整输出资源后可以重试。

## migrate 与 clean 输出案例

supported predecessor 在 ordinary `query`、`view` 或 `exp` 中不会被静默维护；命令明确指出下一步。

```text
$ niceeval query discover
error: record-schema-migration-required
next: niceeval migrate
```

执行 `migrate` 后，成功 receipt 区分事实不变的 physical migration 与会重建 closure 的 family/data migration，但不暴露 SQL、table 或
storage-internal path：

```text
$ niceeval migrate
Migration complete
kind: physical-schema
logical-seal: preserved
```

```text
$ niceeval migrate
Migration complete
kind: family-data
logical-seal: rebuilt
```

已是 current revision 时 `migrate` 仍给出成功、无变更 receipt，而不是伪造 migration：

```text
$ niceeval migrate
Migration not needed
```

`clean` 是另一项 explicit maintenance。它只移除重新验证后仍未发布的 `open` / `sealing` rows；sealed invalid facts 保留并以
`record-database-invalid` 留给受限维护，而不会被 clean 掩盖。

```text
$ niceeval clean
Clean complete
removed: 2 incomplete runs
```

没有可删除的 incomplete closure 同样是成功、无变更的 receipt：

```text
$ niceeval clean
Clean complete
removed: 0 incomplete runs
```

不受支持的 schema identity、无效 database，或需要 family migration 但没有相应 definition 时，普通读取及错误的 maintenance
动作都 fail closed：

```text
$ niceeval migrate
error: record-schema-unsupported
next: use a NiceEval version that supports this record schema

$ niceeval query discover
error: migration-required
next: niceeval migrate

$ niceeval clean
error: record-database-invalid
next: stop ordinary reads and perform restricted maintenance or obtain a new RecordSnapshot

$ niceeval migrate
error: family-definition-required
next: enable the package that defines the required family, then retry
```

这些失败没有成功 receipt，也不删除 sealed facts、导入 0.13.x bytes 或自动重跑 producer。

## Git 与 copy

`.niceeval/record.sqlite` 是 operational database。即使停稳、checkpoint 或 close，raw copy 也不能证明 free pages 没有
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
