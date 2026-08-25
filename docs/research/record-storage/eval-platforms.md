# Eval 与 tracing 平台怎样保存数据

> 观察日期：2026-08-25
>
> 证据范围：官方文档、官方源码，以及已有的逐产品 Record → Report 研究

本页只比较存储边界，不重复各产品完整对象模型。
逐表、逐资源和版本证据见 [Record → Report 产品研究](../record-to-report/README.md)。

## 横向比较

| 系统 | 小事实与查询 | 大材料 | 写入与完成 | 与 NiceEval 的关键差异 |
|---|---|---|---|---|
| MLflow | SQL backend 保存 Run、Metric、Param、Tag、Trace 与 Assessment；FileStore 是另一条实现 | Artifact 由独立 artifact repository / URI 保存 | Run 和 Trace 可持续追加、更新状态 | 面向共享在线 store，不把单 Run 封成自包含不可变 closure |
| Langfuse | PostgreSQL 保存控制面，ClickHouse 保存 observation/score 等分析事实 | S3/Blob storage 保存 event payload、media 与 export | ingestion 可异步，后台生成查询投影 | 依赖服务端多组件与 bucket，目标是跨 trace 查询 |
| Arize Phoenix | SQLite 或 PostgreSQL 保存 Project、Trace、Span、Dataset、Experiment、Annotation | 公开部署形态没有独立的 per-Run blob closure | 通过服务端 schema 与 Alembic 演进 | 本地 SQLite 是整个 Phoenix store，不是一 Run 一文件 |
| ClearML | MongoDB 保存 Task/Model，Elasticsearch 保存 event 明细与查询 | fileserver 或对象存储保存 Artifact、Model 与 media bytes | Task/Event 持续摄入，summary 与明细分开 | 可移植离线 zip 是导入信封，不是服务端权威 store 的单 Run 快照 |
| W&B | 服务端保存 Run、history、summary 与 Artifact metadata | Artifact manifest 指向缓存或对象存储中的文件 | Run 可 live sync；Artifact version finalize 后 manifest 不再修改 | cache、服务端与 bucket 共同构成可用性，不是 self-contained Run |
| Aim | `.aim` repository 的 SQLite 保存 Run metadata，per-Run RocksDB 保存 sequence 数据 | blob 与 sequence 进入 repository storage | 一个 repository 管理多个可继续写入的 Run | portable 单位是整个 repository，不是独立 sealed Run |

MLflow、Langfuse、Phoenix、ClearML 与 W&B 的具名类型、table/file 和 migration 证据分别见：

- [MLflow storage](../record-to-report/mlflow/storage.md)
- [Langfuse storage](../record-to-report/langfuse/storage.md)
- [Phoenix storage](../record-to-report/arize-phoenix/storage.md)
- [ClearML storage](../record-to-report/clearml/storage.md)
- [W&B storage](../record-to-report/weights-and-biases/storage.md)

Aim 官方文档说明 tracked data 位于 `.aim` repository；其存储说明把 `run_metadata.sqlite` 用于结构化 Run metadata，并以 RocksDB 为 sequence storage 基础：
[Manage runs](https://github.com/aimhubio/aim/blob/main/docs/source/using/manage_runs.md)、[Aim 3.10 documentation](https://aimstack.readthedocs.io/_/downloads/en/v3.10.0/pdf/)。

## 能吸收的共同做法

### 小事实与大 bytes 分离

这些系统几乎都不会把任意 Artifact binary base64 进一份 Run JSON。
metadata、identity、status、metric 与引用进入可查询 store；大文件、media、model 或原始 event body 进入 blob/fileserver/object storage，或进入专门的 sequence engine。

NiceEval 可以吸收这条逻辑/物理分界，但不能照搬外部 URI：一个 published Record root 必须自带被引用 Content 的全部 bytes。

### producer 不决定物理分块

SDK 通常只提交 metric、event、file 或 artifact。
数据库 page、ClickHouse part、S3 multipart、RocksDB block 与 cache key 都由平台决定。
这直接支持 NiceEval 的作者边界：business definition 可以声明 item 与 Content，但不得声明 chunk。

### query projection 不应等同于权威材料

MLflow 的 latest metric、ClearML 的 last/min/max summary、Langfuse 的聚合查询都把读取优化与明细事实分开。
NiceEval 若采用 SQLite，也应让索引和 summary 保持 Core-owned projection；family payload 不因一个 Report query 就新增 SQL column。

## 不能直接复制的做法

- 共享数据库加共享 bucket 不能独立复制一份 Run closure。
- server-side last-write-wins、soft delete 与 mutable score 不符合 published Record immutable 的边界。
- 依赖 background uploader、GC 或 remote availability 会让本地 `show`、`view` 和 migration 失去闭包保证。
- 为全局搜索设计的跨 Run schema 不能反推 family 业务字段应进入 Core SQL table。

这些产品证明的是「混合存储很常见」，不是「NiceEval 必须采用某个数据库」。
