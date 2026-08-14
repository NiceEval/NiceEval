# MLflow Storage：entity、表、目录与信封

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页写持久形状。
谁引用谁见 [Layers](layers.md)。
谁在何时写入见 [Execution](execution.md)。
升级是否改写这些字节见 [Schema and migration](schema-and-migration.md)。

## 公开 entity 与 REST resource

用户看见的是 `mlflow.entities.*` 和 Tracking REST，不是表名。

| 公开类型 | 权威身份 | 主要字段 | 权威 / 派生 / cache |
| --- | --- | --- | --- |
| `Experiment` | `experiment_id` 字符串 | `name`、`artifact_location`、`lifecycle_stage`、时间戳、tags | 身份与归属是权威事实 |
| `Run` | `run_id`（32 位 hex） | `RunInfo` status / 起止时间 / `artifact_uri`；`RunData` metrics / params / tags | `RunData.metrics` 在 SQL 路径上是 latest 快照 |
| `Param` | `(run_id, key)` | 字符串 value | 权威且不可改 |
| `Metric` | `(run_id, key, timestamp, step, value, is_nan)` | float | 历史行是权威事实 |
| `RunTag` / `ExperimentTag` | `(owner, key)` | 字符串 value | 权威且可改、可删 |
| `Dataset` / `DatasetInput` | `(experiment_id, name, digest)` 加 input 关联 | name、digest、context tag | 权威事实 |
| `LoggedModel` | `model_id` | name、status、params、tags、关联 metric | 权威事实 |
| Artifact | `artifact_uri` + 相对路径 | 任意字节 | 路径即身份，没有内容哈希 |
| `TraceInfo` / `Trace` | `trace_id` | 时间、state、tags、`trace_metadata`、spans | 见下表 |
| `Feedback` / `Expectation` | `assessment_id` | `name`、`value`、`source`、`rationale`、`valid` | 权威但可改 |
| `EvaluationDataset` | `dataset_id`（`d-` + 32 hex） | name、digest、schema、profile、tags | digest / schema / profile 是算完再存的摘要 |

`Run.to_dictionary()` 是 CLI `mlflow runs describe` 的 JSON 信封。
见 [`mlflow/entities/run.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/run.py)。

## SQL backend：表与 model

实现类是 `SqlAlchemyStore`。
表定义在 [`mlflow/store/tracking/dbmodels/models.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/dbmodels/models.py)。

| 表 | class | 主键 | 类别 |
| --- | --- | --- | --- |
| `experiments` | `SqlExperiment` | 自增整数 `experiment_id` | 权威。对外转成字符串。默认 Experiment `0` 用特殊 INSERT 写入 |
| `experiment_tags` | `SqlExperimentTag` | `(key, experiment_id)` | 权威。key 250，value 5000 |
| `runs` | `SqlRun` | `run_uuid` `String(32)` | 权威。含 status、lifecycle、`artifact_uri`、`deleted_time` |
| `tags` | `SqlTag` | `(key, run_uuid)` | 权威。key 250，value 8000 |
| `params` | `SqlParam` | `(key, run_uuid)` | 权威。value `String(8000)`；文档另写内部上限 6000 |
| `metrics` | `SqlMetric` | `(key, timestamp, step, run_uuid, value, is_nan)` | 权威全历史 |
| `latest_metrics` | `SqlLatestMetric` | `(key, run_uuid)` | cache。每个 key 的最新值，供列表和搜索 |
| `datasets` / `inputs` / `input_tags` | `SqlDataset` / `SqlInput` / `SqlInputTag` | 见 model | 权威关联 |
| `logged_models` 及 metric/param/tag | `SqlLoggedModel*` | `model_id` | 权威 checkpoint |
| `trace_info` | `SqlTraceInfo` | `request_id` | 权威。V3 对外叫 `trace_id` |
| `trace_tags` | `SqlTraceTag` | `(request_id, key)` | 权威 |
| `trace_request_metadata` | `SqlTraceMetadata` | `(request_id, key)` | 权威。V3 对外叫 `trace_metadata` |
| `trace_metrics` | `SqlTraceMetrics` | `(request_id, key)` | 聚合后写入的值 |
| `spans` | `SqlSpan` | `(trace_id, span_id)` | 权威 JSON 在 `content`；`duration_ns` 是 persisted generated column |
| `span_metrics` | `SqlSpanMetrics` | `(trace_id, span_id, key)` | 从 attributes 抽出的 token / cost |
| `assessments` | `SqlAssessments` | `assessment_id` | 权威。`value` / `error` / metadata 是 JSON 文本 |
| `evaluation_datasets` | `SqlEvaluationDataset` | `dataset_id` | digest / schema / profile 是摘要 |
| `evaluation_dataset_records` | `SqlEvaluationDatasetRecord` | `dataset_record_id` | 权威测试行。`input_hash` 用于去重 |
| `entity_associations` | `SqlEntityAssociation` | 四元组 source/destination | Trace 与 Run / Prompt 的关联 |

产品事实：`SqlRun.to_mlflow_entity()` 装进 `RunData` 的是 `latest_metrics`，不是 `metrics` 全表。
全历史要另走 `get_metric_history`。

产品事实：SQL `experiment_id` 是整数主键。
FileStore 用 `_generate_unique_integer_id()` 生成更大的整数，再当成目录名。
这就是 `migrate-filestore` 只支持 SQLite 的原因：PostgreSQL / MySQL 的 32 位整数装不下这些 ID。
见 [Migrate from File Store](https://mlflow.org/docs/latest/self-hosting/migrate-from-file-store/)。

产品事实：`SqlSpan.duration_ns` 定义为 `end_time_unix_nano - start_time_unix_nano`。
进行中的 span 因 `end_time` 为空，duration 也是 NULL。

## FileStore：目录与文件信封

实现类是 `FileStore`。
根目录默认 `./mlruns`。
常量在 [`file_store.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py)。

```text
mlruns/
  .trash/                          被删 Experiment 的停放处
  <experiment_id>/
    meta.yaml                      Experiment 信封
    tags/<key>                     文件名即 key，内容即 value
    datasets/
    traces/<trace_id>/             见下
    models/
    <run_id>/
      meta.yaml                    RunInfo；status 存成整数枚举
      metrics/<key>                追加文本行：timestamp value step
      params/<key>                 单文件字符串
      tags/<key>                   单文件字符串
      artifacts/                   默认本地 artifact 根
      inputs/  outputs/
```

Trace 目录：

```text
<experiment_id>/traces/<trace_id>/
  trace_info.yaml
  request_metadata/<key>
  tags/<key>
  assessments/<assessment_id>.yaml
```

产品事实：Run `meta.yaml` 仍写出空的 `tags: []`，以便旧客户端读取。
status 落盘时是整数枚举，读回时再转成字符串。

产品事实：metric 文件按行追加。
2、3、5 段都合法，分别对应无 step、有 step、以及带 dataset name/digest。

产品事实：`get_run` 时，FileStore 对每个 metric 文件用 `(step, timestamp, value)` 取 `max`，在读取时算出 latest。
它没有 `latest_metrics` 文件。

产品事实：span 字节不在这些 YAML 里。
`TracingClient.get_trace` 若看见 `mlflow.trace.spansLocation` 不是 tracking store / archive，就去 artifact URI 读 `traces.json`。
文件名常量是 `TRACE_DATA_FILE_NAME = "traces.json"`。
见 [`mlflow/tracing/utils/artifact_utils.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracing/utils/artifact_utils.py)。

产品事实：Assessment 文件是 `assessment.to_dictionary()` 的 YAML。

FileStore 拒绝 Evaluation Dataset、`log_spans`、`query_trace_metrics` 和 `link_traces_to_run`。
装饰器在 [`_sql_backend_utils.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/_sql_backend_utils.py)。

## Artifact Store

产品事实：Param、Metric、Tag 在 Backend Store。
模型权重、图像、`log_table` JSON、figure、部分 Trace span 在 Artifact Store。
见 [Artifact Stores](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)。

产品事实：SQL 创建 Run 时，`artifact_uri` 是 `experiment.artifact_location / run_id / artifacts`。
删除 Run 不会自动清这些字节。永久清除走 `mlflow gc`。

产品事实：支持的 URI 包括本地路径、S3、GCS、Azure Blob、SFTP、NFS、HDFS。
3.15.0 起，非代理的 S3 artifact 可用短时 presigned URL 让浏览器直下。
本次检查的一手公开面未把 artifact 做成内容寻址闭包。

## 权威、派生、summary / index / cache

| 数据 | SQL | FileStore | 类别 |
| --- | --- | --- | --- |
| Experiment / Run / Param / Tag | 表行 | `meta.yaml` 与单文件 | 权威事实 |
| metric 全历史 | `metrics` | `metrics/<key>` 文本行 | 权威事实 |
| 每个 key 的 latest metric | `latest_metrics` | 读取时 `max(step, timestamp, value)` | SQL 是 cache；FileStore 是读时计算 |
| span `content` | `spans.content` | artifact `traces.json` | 权威事实 |
| span `duration_ns` | persisted generated column | 无此列 | 派生后落盘 |
| `trace_metrics` / `span_metrics` | 聚合值表 | 无对应查询面 | 派生后落盘 |
| Evaluation Dataset `schema` / `profile` / `digest` | 算完再写入 | 功能不可用 | summary |
| UI chart、pandas 聚合、缺列 `NaN` | 读取时计算 | 读取时计算 | 非持久 |
| OTel 翻译后的 `mlflow.spanType` | 可写进 span attributes / 展示映射 | 同左 | 展示派生，不一定改 `content` |

产品事实：`latest_metrics` 是典型的“本可每次从历史计算，却为搜索单独写入”的表。
比较键是 `(step, timestamp, value)`。更新时对已有行 `SELECT ... FOR UPDATE`。
见 [`SqlAlchemyStore._update_latest_metrics_if_necessary`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

研究判断：作者新增 metric 名字或 artifact 路径时，不发布新的持久格式。
平台继续用固定信封。代价是 latest、duration、digest 会作为派生事实落盘。
这些派生列对升级的影响见 [Schema and migration](schema-and-migration.md)。
