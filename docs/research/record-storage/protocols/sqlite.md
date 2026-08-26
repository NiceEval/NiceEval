# SQLite application file

> 观察日期：2026-08-25
>
> 本地运行时：Node v24.19.0，内置 SQLite 3.53.3

SQLite 官方把带固定 schema 的 database 定位为 application file。
它提供跨平台稳定文件格式、原子 transaction、增量更新、索引和多语言读取。

## 格式已经提供什么

- page、B-tree、row 与 secondary index；
- rollback journal 或 WAL 下的 crash recovery；
- 同一 database 内的原子 transaction；
- read-only cursor 与按需 row/BLOB 读取；
- 单个 final file 的复制与长期兼容。

transaction 期间的 hot journal 或 WAL 是 database state 的一部分。
因此 active database 不能只复制 main file。
一 Run 一 file 候选仍需要 outer publication；root-wide database 可以用 transaction 发布 logical Run，并用 Host snapshot 形成活动副本。

## Node 24 的真实边界

PLAN-4 所需的最低版本是 Node 24.15.0。
该版本同时把 `node:sqlite` 标为 RC、携带 SQLite 3.51.3 WAL-reset 修复，并提供 runtime limits。
`setAuthorizer` 从 Node 24.10.0 提供，defensive mode 从 24.14.0 默认开启。

`node:sqlite` 的公开 connection 是同步 `DatabaseSync`。
Statement 的 BLOB 输入输出是完整 `TypedArray`/`Uint8Array`，公开 API 没有 C API 的 `sqlite3_blob_open()` incremental handle。

C incremental BLOB API 也只能读取或原位改写已分配 BLOB，不能改变 BLOB 长度。
它不是未知长度 Stream 的自动 append 接口。
NiceEval 若采用内置 Node API，应以 bounded `content_chunks` rows 持续写入，而不是把一个 logical Content 绑定成巨型 BLOB。

## 可检验的 NiceEval profile

```text
runs                 Run identity 与 publication state
owners               Attempt / Run owner
families             family identity、revision 与 raw envelope
singleton_values     create-once canonical bytes
collection_items     owner/family/ordinal + canonical item bytes
contents             handle、logical byteLength、overall digest
content_chunks       handle、ordinal、bounded bytes、chunk digest
references           source/target generic reference
seal_entries         exact logical inventory
```

表名只是 spike 输入，不是 schema 定案。
关键点是每个 row 保持有界，logical Content 由 ordered chunk rows 拼接；family payload 始终是 generic raw bytes。

SQLite 可以原生承担 item uniqueness、canonical-order cursor、reference inventory 与 logical transaction。
NiceEval 仍须定义 Content overall digest、capture completeness、family migration、Run Seal 和 outer rename/receipt。

## 单文件候选不能用文件大小直接排除

SQLite page/row 读取的 RSS 不随 database file length 线性增长。
默认 page-count 上限对应约 17.5 TB 的 4 KiB-page database；更早的实际边界通常来自 filesystem、disk 或 Host policy。

这不证明无限大 database 安全，也不取消 hostile-input limits。
它只说明“单文件可能很大”与“必须整体加载”不是同一件事。
若 NiceEval 保留低于真实 Run 规模的 durable-member ceiling，SQLite 会被政策排除；这个 ceiling 需要独立证据。

## Spike 结果

[Root-wide SQLite 采用收据](../root-wide-sqlite-receipt.md)给出 144 MiB Content、50,000 items、writer contention、backup、crash、migration、hostile reader 与 worker startup 结果。

结果支持 bounded chunk rows 与 transaction publication，但也暴露两个 Host 责任：SQLite 不保证 writer fairness，`backup()` 在连续外部写入时会 restart。
PLAN-4 因此必须提供 bounded write admission、typed contention 与 snapshot barrier，不能把 WAL 当成完整的协调协议。

## 官方资料

- [SQLite as an application file format](https://www.sqlite.org/appfileformat.html)
- [SQLite database file format](https://www.sqlite.org/fileformat.html)
- [SQLite limits](https://www.sqlite.org/limits.html)
- [Write-ahead logging](https://www.sqlite.org/wal.html)
- [Temporary files and journals](https://www.sqlite.org/tempfiles.html)
- [`sqlite3_blob_open()`](https://www.sqlite.org/c3ref/blob_open.html)
- [Node v24.19.0 `node:sqlite`](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)
