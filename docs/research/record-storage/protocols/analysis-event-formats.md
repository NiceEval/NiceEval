# 分析与事件格式

> 观察日期：2026-08-25

DuckDB、Parquet、Arrow IPC 与 Perfetto各自解决分析或事件摄入问题。
它们提供可借鉴的底层机制，但没有 NiceEval active Record 的 closure 与 publication 语义。

## DuckDB

DuckDB 是 embedded OLAP database，使用单 file storage、WAL 与 columnar execution。
它更擅长 batch ingestion、scan、join 与聚合，不以逐 item capture 和 opaque bytes 保存为第一目标。

NiceEval 可以在 seal 后把 Record 投影到 DuckDB 做 Analysis。
把它用于 active Record，会同时承担 native dependency、WAL/publication 与 storage-version 问题，却没有 SQLite 在 application-file 稳定性上的同等证据。

## Parquet

Parquet 以 row group、column chunk、page 与 footer metadata 组织列式文件。
它适合压缩、列裁剪与 batch interchange。

footer 在文件尾关闭 schema 和 row-group locations。
这不等于 Run transaction、Attempt completeness 或 reference closure。
大型 Artifact 放进 binary column 也不自动取得 Content handle、stream lifecycle 与 overall digest。

## Arrow IPC

Arrow IPC stream 是 Schema、RecordBatch 与 DictionaryBatch 的 message sequence。
Arrow IPC file 在 stream 数据后增加 footer，保存 schema 与 block offsets，支持 record-batch random access。

Arrow 的优势是列式内存布局、跨语言 interchange 与低复制读取。
代价是 mutation 较贵，而且同一 record batch 的 arrays 具有共同 row count；unknown heterogeneous family 不是它的自然模型。

官方安全说明还要求 reader 验证 untrusted IPC metadata、buffer offset 与 array data。
因此 Arrow library 的 parser 不能替代 NiceEval hostile-input 与 closure validation。

## Perfetto trace

Perfetto 原生 trace 是线性的 protobuf `TracePacket` 序列。
单 writer packet 保序，多 writer packet 可以交错；Trace Processor 摄入 packet 后提供 SQL 查询。

它证明 producer-facing event stream 不必暴露 physical page/chunk，也证明 arrival order 与 semantic order 应分开。
它不保存 family schema、Content closure、capture complete 与 storage migration，只能作为 collection/event ingestion 参照。

## 研究判断

| 格式 | 最适合 NiceEval 的角色 | 不应承担的角色 |
|---|---|---|
| DuckDB | seal 后 Analysis engine | active opaque Record truth |
| Parquet | 分析/export interchange | mixed Artifact 与 transactional capture |
| Arrow stream | 内部 batch pipe | durable Run closure |
| Arrow file | sealed analytical snapshot | active append truth |
| Perfetto | event ingestion 参照 | family/reference/Content store |

## 官方资料

- [DuckDB storage](https://duckdb.org/docs/stable/internals/storage)
- [DuckDB files and WAL](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb)
- [Parquet file format](https://parquet.apache.org/docs/file-format/)
- [Arrow columnar and IPC format](https://arrow.apache.org/docs/format/Columnar.html)
- [Arrow security considerations](https://arrow.apache.org/docs/format/Security.html)
- [Perfetto TracePacket reference](https://perfetto.dev/docs/reference/trace-packet-proto)
- [Perfetto Trace Processor architecture](https://perfetto.dev/docs/analysis/trace-processor)
