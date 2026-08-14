# Langfuse 持久结构：type、表、文件与信封

> 观察日期：2026-08-14
>
> 核对源码：`langfuse/langfuse` `7cc6d2c0`；文档仓 `d0a5f34e`
>
> 返回 [目录](README.md)

本页只写存什么、存在哪、哪一份是权威。
谁在何时写入见 [execution.md](execution.md)。
版本轨道与是否改写已保存数据见 [schema-and-migration.md](schema-and-migration.md)。

## 四类存储

官方 handbook 与 `CONTRIBUTING.md` 的分工一致。
见 [Architecture](https://langfuse.com/handbook/product-engineering/architecture)。

| 存储 | 角色 | 放什么 |
|---|---|---|
| PostgreSQL | OLTP | 用户、组织、项目、API key、Prompt、Dataset、DatasetItem、DatasetRuns、ScoreConfig、Dashboard、Media 元数据、JobExecution、BackgroundMigration |
| ClickHouse | OLAP | Trace / Observation / Score / DatasetRunItem / events |
| Redis / Valkey | 队列与缓存 | BullMQ payload（正常路径为 S3 引用，上传失败时为整批事件）、API key / Prompt 缓存 |
| S3 / Blob | 对象存储 | 原始 ingestion JSON、多模态附件 |

Postgres schema：`packages/shared/prisma/schema.prisma`。
ClickHouse 表名字典：`packages/shared/src/server/clickhouse/schema.ts` 的 `ClickhouseTableNames`。

## 公开 type / class

| 符号 | 路径 | 对应资源 |
|---|---|---|
| `ObservationType` / `ObservationSchema` | `packages/shared/src/domain/observations.ts` | Observation |
| `EventsObservationSchema` | 同上 | Observation 加上复制来的 Trace 属性 |
| `TraceDomain` | `packages/shared/src/domain/traces.ts` | 跨前后端共用的 Trace 形状；v4 默认读取不再以它为权威表 |
| `ScoreSchema` / `ScoreSourceEnum` / `ScoreDataTypeEnum` | `packages/shared/src/domain/scores.ts` | Score |
| `DatasetItemDomain` | `packages/shared/src/domain/dataset-items.ts` | DatasetItem |
| `DatasetRunItemSchema` | `packages/shared/src/domain/dataset-run-items.ts` | DatasetRunItem 加 run / item 快照 |
| `ExperimentResult` | `langfuse-python` `langfuse/experiment.py` | 客户端对象，不入库 |
| Fern `Experiment` / `ExperimentItem` | `fern/apis/server/definition/experiments.yml` | 公开读取 resource |

Observation 类型是封闭枚举。
官方小写名见 [Observation Types](https://langfuse.com/docs/observability/features/observation-types)。
源码值为大写：`EVENT`、`SPAN`、`GENERATION`、`AGENT`、`TOOL`、`CHAIN`、`RETRIEVER`、`EVALUATOR`、`EMBEDDING`、`GUARDRAIL`。
用户不能注册新类型。
`level` 是 `DEBUG`、`DEFAULT`、`WARNING`、`ERROR`。

`ScoreSchema` 相对官方 [Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model) 的补充：

| 字段 | 官方文档 | 源码补充 |
|---|---|---|
| `dataType` | NUMERIC、CATEGORICAL、BOOLEAN、TEXT | 另有 `CORRECTION` |
| `source` | `API`、`EVAL`、`ANNOTATION` | 公开创建端点不能写 `EVAL` |
| `stringValue` | CATEGORICAL / BOOLEAN / TEXT | TEXT 最长 `TEXT_SCORE_MAX_LENGTH = 500` |
| `executionTraceId` | 文档页未列 | ClickHouse 列；Judge 自己的 Trace |
| `longStringValue` | 文档页未列 | domain 默认 `""` |

`PublicApiCreateScoreSourceDomain` 只允许 `API` 与 `ANNOTATION`。
`AGGREGATABLE_SCORE_TYPES` 是 `NUMERIC`、`BOOLEAN`、`CATEGORICAL`。

`DatasetRunItemSchema` 除身份外还带：

- 失败：`error`
- Run 快照：`datasetRunName`、`datasetRunDescription`、`datasetRunMetadata`、`datasetRunCreatedAt`
- Item 快照：`datasetItemInput`、`datasetItemExpectedOutput`、`datasetItemMetadata`、`datasetItemVersion`

## Postgres model / table

| 模型 | 表 | 身份 |
|---|---|---|
| `Project` | `projects` | `id`；含 `homeDashboardId`、`retentionDays` |
| `TraceSession` | `trace_sessions` | `@@id([id, projectId])` |
| `ScoreConfig` | `score_configs` | `id`；`dataType` 为 CATEGORICAL / NUMERIC / BOOLEAN / TEXT |
| `Dataset` | `datasets` | `@@id([id, projectId])`；`@@unique([projectId, name])` |
| `DatasetItem` | `dataset_items` | `@@id([id, projectId, validFrom])` |
| `DatasetRuns` | `dataset_runs` | `@@id([id, projectId])`；`@@unique([datasetId, projectId, name])` |
| `EvalTemplate` | `eval_templates` | `@@unique([projectId, name, version])` |
| `JobConfiguration` | `job_configurations` | `id` |
| `JobExecution` | `job_executions` | `id`；无指向 Trace 的 FK |
| `Media` | `media` | `@@unique([projectId, sha256Hash])` |
| `TraceMedia` / `ObservationMedia` / `DatasetItemMedia` | 同名 snake | 把 token 绑到主体 |
| `Dashboard` | `dashboards` | `definition` JSON、`filters` JSON |
| `DashboardWidget` | `dashboard_widgets` | `view`、`dimensions`、`metrics`、`filters`、`chartType`、`chartConfig`、`minVersion` |
| `BackgroundMigration` | `background_migrations` | `name` unique |
| `AnnotationQueueItem` | `annotation_queue_items` | `PENDING` / `COMPLETED` |

Postgres 不存 Observation 行，也不存 Score 行。

## ClickHouse table

物理表：

| 表 | 引擎 | 用途 |
|---|---|---|
| `traces` | `ReplacingMergeTree(event_ts, is_deleted)` | v3 与 `legacy` / `dual` 写入 |
| `observations` | 同上 | 同上 |
| `scores` | 同上 | Score 权威表；v4 仍写 |
| `dataset_run_items_rmt` | 同上 | DatasetRunItem 权威表 |
| `events_full` | 同上 | v4 不可变、完整保真事件 |
| `events_core` | 同上 | 截断投影，供表与图 |

建表文件都在 `packages/shared/clickhouse/migrations/unclustered/`：

- `0001_traces.up.sql`、`0002_observations.up.sql`、`0003_scores.up.sql`
- `0024_dataset_run_items.up.sql`
- `0039_create_events_full.up.sql`、`0040_create_events_core.up.sql`、`0041_create_events_core_mv.up.sql`

`ClickhouseTableNames` 还登记虚拟名：`events_proto`（UI 列映射占位）、`scores_numeric` / `scores_boolean` / `scores_categorical`、`events_traces` / `events_observations`。

`events_full` 列组见 `0039_create_events_full.up.sql`：

| 组 | 列 |
|---|---|
| 身份 | `project_id`、`trace_id`、`span_id`、`parent_span_id` |
| 时间 | `start_time`、`end_time`、`completion_start_time` |
| 核心 | `name`、`type`、`environment`、`version`、`release`、`trace_name`、`user_id`、`session_id`、`tags`、`level`、`is_app_root` |
| 可改展示 | `bookmarked`、`public` |
| 用量 | `provided_model_name`、`usage_details`、`cost_details` 及 `MATERIALIZED` cost 列 |
| I/O | `input`、`output`（ZSTD）；`input_length` / `output_length` MATERIALIZED |
| Experiment | `experiment_id`、`experiment_name`、`experiment_item_id`、`experiment_item_version`、`experiment_item_expected_output` 等 |
| 系统 | `blob_storage_file_path`、`event_bytes`、`event_ts`、`is_deleted` |

`0042_add_events_ingestion_attribution_columns.up.sql` 再加 `ingestion_api_key`、`ingestion_sdk_name`、`ingestion_sdk_version`。

`events_core_mv` 把 `input` / `output` / `metadata_values` 截到 200 字符：

```sql
leftUTF8(input, 200) as input
leftUTF8(output, 200) as output
arrayMap(v -> leftUTF8(v, 200), metadata_values) as metadata_values
```

列表与图表读 `events_core`。
详情再读 `events_full`。
原则见 `.agents/ARCHITECTURE_PRINCIPLES.md`。

## Redis / Valkey

BullMQ 的队列名与 payload 契约集中在 [`packages/shared/src/server/queues.ts`](https://github.com/langfuse/langfuse/blob/7cc6d2c0b925c282021fdea11176066927ca4ab3/packages/shared/src/server/queues.ts)。
Redis 保存调度状态与 cache，不拥有 Observation、Score 或 DatasetRunItem 的权威事实。

| 队列 | payload 或用途 |
|---|---|
| `ingestion-queue`、`otel-ingestion-queue` 及 secondary 队列 | 正常路径传 S3 object 引用；S3 上传失败时 fallback 才传整批事件 |
| `dataset-run-item-upsert-queue` | `DatasetRunItemUpsert`，触发异步 evaluator |
| `evaluation-execution-queue` | 平台评测调度 |
| `llm-as-a-judge-execution-queue` | LLM-as-a-Judge 执行 |
| `code-eval-execution-queue` | code evaluator 执行 |

API key 与 Prompt 也会进入 Redis cache。
cache 失效只触发重新读取，不改变 Postgres 或 ClickHouse 行。

## 文件 / 目录 / 对象键

| 路径 | 内容 |
|---|---|
| `{LANGFUSE_S3_EVENT_UPLOAD_PREFIX}{projectId}/{entityType}/{entityId}/{eventId}.json` | 标准 ingestion 信封 |
| `otel/{projectId}/{yyyy}/{mm}/{dd}/{hh}/{mm}/{eventId}.json` | OTel 事件 |
| `Media.bucketName` / `Media.bucketPath` | 媒体字节 |

符号：`buildEventBucketPrefix`、`STANDARD_EVENT_KEY_REGEX`、`OTEL_EVENT_KEY_REGEX`。
路径：`packages/shared/src/server/ingestion/eventBucketPath.ts`。

内部事件 type 在 `packages/shared/src/server/ingestion/types.ts` 的 `eventTypes`：

- Trace 与基本 Observation：`trace-create`、`span-create` / `span-update`、`generation-create` / `generation-update`
- 其余 Observation：各 observation `*-create`
- 相邻资源：`score-create`、`dataset-run-item-create`、`sdk-log`
- 旧信封：`observation-create` / `observation-update`

`getClickhouseEntityType()` 把它们收成 `trace`、`observation`、`score`、`dataset_run_item`。
路径：`packages/shared/src/server/clickhouse/schemaUtils.ts`。

媒体 token 是整段字符串：

```text
@@@langfuseMedia:type={MIME_TYPE}|id={LANGFUSE_MEDIA_ID}|source={SOURCE_TYPE}@@@
```

见 [Multi-Modality](https://langfuse.com/docs/observability/features/multi-modality)。
扫描函数：`findMediaReferences`，`packages/shared/src/utils/mediaReferences.ts`。

Dashboard 可移植信封：

```text
{"$langfuseWidget": true, "version": 1, ...}
{"$langfuseDashboard": true, "version": 1, ...}
{"$langfusePreset": true, "version": 1, "presetId": "..."}
```

符号：`WIDGET_FILE_FORMAT_VERSION = 1`、`DASHBOARD_FILE_FORMAT_VERSION = 1`。
路径：`web/src/features/widgets/utils/import-export-utils.ts`、`web/src/features/dashboard/utils/dashboard-import-export.ts`。
Dashboard 文件内联全部 Widget 配置，不携带数据库 ID。

## API resource

| resource | 端点 | Fern |
|---|---|---|
| Observation | `GET /api/public/v2/observations` | `observations.yml` |
| Metrics 查询 | `GET /api/public/v2/metrics` | `metrics.yml` |
| Score | `POST /api/public/scores`；`GET /api/public/v3/scores` | `scores.yml`、`scores-v3.yml` |
| Experiment | `GET /api/public/experiments`、`/experiment-items` | `experiments.yml` |
| OTel traces | `POST /api/public/otel/v1/traces` | `opentelemetry.yml` |
| Media | `POST /api/public/media` | `media.yml` |
| Dashboard / Widget | `/api/public/unstable/dashboards`、`/dashboard-widgets` | `unstable/`；契约未定稿 |

Fern `Experiment.id` 文档写：dataset run ID (experiment ID)。

## 权威事实、派生值、summary / index / cache

| 量 | 类别 | 依据 |
|---|---|---|
| Observation `id` / `trace_id` / `type` / `start_time` | 权威写入 | `ObservationSchema`；v4 在 `events_full` |
| Trace 级 `user_id`、`session_id`、`tags` | 权威写入，并复制到每一行 | [Core Concepts](https://langfuse.com/docs/observability/data-model) |
| `provided_usage_details` / `provided_cost_details` | 权威写入 | 用户或集成原样提供 |
| `usage_details` / `cost_details` | 摄入时可能被 Worker 补全后持久化 | [Token & Cost](https://langfuse.com/docs/observability/features/token-and-cost-tracking) |
| `Dataset` / `DatasetItem` / `DatasetRuns` 行 | Postgres 权威 | `schema.prisma` |
| `dataset_run_items_rmt` 及其 item 快照 | ClickHouse 权威快照 | `DatasetRunItemSchema` |
| Score 行 | ClickHouse `scores` 权威 | `ScoreSchema` |
| `events_full.experiment_*` | 摄入时写入的冗余列 | 供 Experiments API 扫描，不回 join Postgres |
| `latency`、`timeToFirstToken` | 读取派生 | Observations API `metrics` 组；`events_full` 只存起止时间 |
| `calculated_*_cost`、`input_length` | 表内 MATERIALIZED | `0039_create_events_full.up.sql` |
| `total_cost` | ALIAS `cost_details['total']` | 同上 |
| `events_core.input` / `output` | 截断投影，最多 200 字符 | `events_core_mv` |
| `isRootObservation` | 读取派生 | 组合 `parent_span_id` 与持久列 `is_app_root` |
| Experiment `startTime` / `endTime` / `itemCount` | 按查询时间范围派生 | `experiments.yml` |
| `ExperimentResult` | 客户端对象，不入库 | `langfuse/experiment.py` |
| Dashboard / Widget JSON | 查询声明，不是查询结果 | `dashboards` / `dashboard_widgets` |
| bloom / text index | ClickHouse 索引 | `0039` / `0043`；不改变用户事实 |
| Redis API key / Prompt | cache | handbook；失效不改变权威行 |
| Redis ingestion payload | 调度输入 | 正常路径只含 S3 引用；S3 失败 fallback 含整批事件 |
| S3 ingestion JSON | 摄入中间对象与 retry 输入 | `processEventBatch` 写入；replay 脚本可再次摄入 |
| S3 Media 字节 | Media payload | Postgres `Media` 行保存 bucket 与 SHA256 身份 |

Usage 与 cost 只写在 `generation` 与 `embedding` 上。
键是任意字符串；`input` / `output` 是最高层约定。
每个 key 必须是互斥 bucket。
`total` 不是 bucket；未写入时由各 bucket 求和。
已摄入值优先于按 model 推断的值。
见 [Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking#ingest)。

`is_app_root` 是 `events_full` 上的持久布尔列。
一个 app-root Observation 可以同时 `isRootObservation=true` 且 `parentObservationId` 非空。
见 Fern `observations.yml`。

本可计算却仍持久化的量包括 Trace 属性副本、推断后的 usage/cost、run/item 快照与 `experiment_*` 冗余列。
`events_core` 截断副本、表内计算的 cost 与 `event_bytes` 也会持久化。
坚持读取时计算的量：`latency`、Metrics 聚合、Experiment 时间范围汇总、Dashboard 图表、Widget CSV。
对 schema churn 的影响见 [schema-and-migration.md](schema-and-migration.md)。
