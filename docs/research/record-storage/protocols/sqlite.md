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
因此 active database 不能只复制 main file；NiceEval 仍须用 staging 与 outer publication 形成 portable closure。

## Node 24 的真实边界

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

## 必须由 spike 回答

1. worker-thread actor 的 fairness、取消、throughput 与 RSS；
2. chunk-row write/stream-read 在 RS2、RS3 与 RS13 下的 page/cache 行为；
3. hot staging 到 exact final file 的唯一 exporter、临时磁盘与 seal wall time；
4. hostile database 在 ordinary lazy read 前需要多少结构验证；
5. extra schema object、trigger/view、extension/ATTACH 与 runtime limits 的拒绝面；
6. unknown family 的 raw-row/chunk copy-on-write migration；
7. single large file 的 Git/copy、filesystem 与 recovery 现实成本。

## 官方资料

- [SQLite as an application file format](https://www.sqlite.org/appfileformat.html)
- [SQLite database file format](https://www.sqlite.org/fileformat.html)
- [SQLite limits](https://www.sqlite.org/limits.html)
- [Write-ahead logging](https://www.sqlite.org/wal.html)
- [Temporary files and journals](https://www.sqlite.org/tempfiles.html)
- [`sqlite3_blob_open()`](https://www.sqlite.org/c3ref/blob_open.html)
- [Node v24.19.0 `node:sqlite`](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)
