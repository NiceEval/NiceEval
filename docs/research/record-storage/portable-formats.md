# 便携 application、columnar 与 trace 格式

> 观察日期：2026-08-25
>
> 本地运行时：Node v24.19.0，内置 SQLite 3.53.3

本页比较格式本身，不把格式的查询能力误当成 NiceEval 领域模型。

## SQLite

SQLite 官方把数据库描述为稳定、跨平台、事务性的 application file。
一个文件可以保存多张表、索引与 BLOB；同一文件同时只有一个 writer。
transaction 期间 rollback journal 或 WAL sidecar 是数据库状态的一部分，因此「数据库最终是单文件」不等于「热库可随时只复制主文件」。

Node 24 的 `node:sqlite` 提供同步 `DatabaseSync`、read-only/defensive/limits 与完整 `Uint8Array` BLOB binding；公开 API 没有等价于 C `sqlite3_blob_open()` 的 incremental BLOB handle。
逻辑 Content 若放 SQLite，需要由 Host 自己写 bounded chunk rows，不能把一个 64 MiB `Uint8Array` 当作自动流式 I/O。

官方资料：

- [SQLite as an application file format](https://www.sqlite.org/appfileformat.html)
- [SQLite file format stability](https://www.sqlite.org/fileformat.html)
- [Write-ahead logging](https://www.sqlite.org/wal.html)
- [Temporary files and journals](https://www.sqlite.org/tempfiles.html)
- [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto)
- [SQLite security guidance](https://www.sqlite.org/security.html)
- [Node v24.19.0 `node:sqlite`](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)

适合 NiceEval 的部分是大量小 item、唯一约束、canonical-order index、transactional inventory 与单文件封装。
风险是同步 worker/actor、hostile database 读取、seal 时 snapshot/export、二进制 Git diff 与 storage revision。

## DuckDB

DuckDB 也是单文件 embedded database，但核心目标是 OLAP 与 columnar execution。
它会在写入期形成 WAL 和临时文件；storage format 的长期兼容承诺也晚于 SQLite。

官方资料：

- [DuckDB storage](https://duckdb.org/docs/stable/internals/storage)
- [Files created by DuckDB](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb)
- [Concurrency](https://duckdb.org/docs/stable/connect/concurrency)

NiceEval 的 active Record 更重视逐 item 写入、强 seal 与 unknown family byte preservation，不以列式 scan 为第一目标。
DuckDB 更适合 Analysis projection，不是当前 Record 物理层的领先候选。

## Parquet 与 Arrow IPC

Parquet 是带 footer metadata 的列式文件格式；Arrow IPC 提供 file 与 stream 两种 message framing。
它们适合 batch interchange、列裁剪和向量化读取，却不提供 NiceEval 所需的多 family transaction、引用闭包、collection terminal seal 与 crash publication。

官方资料：

- [Parquet file format](https://parquet.apache.org/docs/file-format/)
- [Arrow columnar and IPC format](https://arrow.apache.org/docs/format/Columnar.html)

两者可以作为 seal 后的 Analysis/export 格式，不应因为查询快就成为 active Record 的唯一真相。

## Perfetto trace

Perfetto 原生 trace 是线性的 protobuf `TracePacket` 序列。
单个 writer 的 packet 保序，不同 writer 的 packet 可以交错；consumer 可以用 timestamp 重建需要的总序。
Trace Processor 把 packet 摄入后提供 SQL 查询，SQLite 视图不是原生 trace 文件格式。

官方资料：

- [TracePacket reference](https://perfetto.dev/docs/reference/trace-packet-proto)
- [Trace Processor architecture](https://perfetto.dev/docs/analysis/trace-processor)

Perfetto 证明 producer-facing event stream 不需要暴露物理 page/chunk，也证明 arrival order 与 canonical semantic order 必须分开。
它不保存 NiceEval 的 family schema、Content closure、terminal completeness 与相邻 migration，所以只能作为 collection/event ingestion 参照。

## 研究判断

| 格式 | active append | 大 Content | transaction/seal | lazy item query | self-contained file | 适合角色 |
|---|---|---|---|---|---|---|
| SQLite | 强；单 writer | 需 Host chunk rows | 强 transaction；外层 publication 仍自管 | 强 | seal 后可做到 | Record 候选 |
| DuckDB | batch/OLAP 更强 | 不作为主要 blob store | 有 WAL；目标不同 | 列式 query 强 | seal 后可做到 | Analysis 候选 |
| Parquet/Arrow file | 弱 | binary column 可表达，不等于 content lifecycle | 无 Run transaction | 列式读取强 | 是 | export |
| Arrow stream | 强顺序 stream | message framing | 无 durable Run seal | 顺序消费 | 是/传输流 | 内部管道 |
| Perfetto trace | 强 packet append | 可放 bytes，但无 Content closure | trace 完成不等于 Record seal | 摄入后强 | 是 | observability trace |

SQLite 是唯一同时提供「大量小 item + 索引 + transaction + 单文件」的候选；是否采用它，仍取决于 NiceEval 是否真的采用 generic collection，而不是取决于品牌或文件后缀。
