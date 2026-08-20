# LangSmith 的持久结构与读取投影

本页把公开 wire/resource schema 与物理 datastore 分开。除特别注明，源码证据固定在官方 `langchain-ai/langsmith-sdk` commit [`345a522`](https://github.com/langchain-ai/langsmith-sdk/commit/345a52252af163abe33699fb361038f5783c9024)（2026-08-13 UTC）。部署证据固定在官方 `langchain-ai/helm` commit [`e5fd3cf`](https://github.com/langchain-ai/helm/commit/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0)（2026-08-12 UTC）。**公开 class 名或 API resource 不等于同名数据库 table。**

## 公开 durable resources

下表列出服务端可在以后重新读取的逻辑事实。字段按公开 Python schema 或生成自官方 OpenAPI 的 v2 model 分组列全；`Optional` 只表示响应可能省略或为 null，不说明底层列是否 nullable。

| Resource / 公开 type | 身份、权威 payload 与引用 | 服务端补充或聚合字段 |
| --- | --- | --- |
| Dataset / [`Dataset`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L222-L300) | `id`, `name`, `description`, `data_type`, `created_at`, `modified_at`, `inputs_schema`, `outputs_schema`, `transformations`, `metadata` | `example_count`, `session_count`, `last_session_start_time` 是 hydrated counts/timestamp，不是 Dataset 内容本身 |
| Example / [`ExampleCreate`, `Example`, `ExampleUpdate`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L82-L218) | `id`, `dataset_id`, `inputs`, `outputs`, `metadata`, `created_at`, `modified_at`, `source_run_id`; create/upsert 另接受 `split`, `attachments`, `use_source_run_io`, `use_source_run_attachments`; update 接受 attachment retain/rename operations | 返回 attachment 名到 presigned URL/reader 的映射；URL 是访问能力，不是附件 bytes 的逻辑内容 |
| Project / [`TracerSession`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L704-L795) | `id`, `tenant_id`, `name`, `description`, `start_time`, `end_time`, `extra`（含 metadata/tags）, `reference_dataset_id`；后者非空时形成 Experiment | `TracerSessionResult` 加 `run_count`, latency/first-token p50/p99, token/cost totals, `last_run_start_time`, `feedback_stats`, `session_feedback_stats`, `run_facets`, `error_rate` |
| Run v1 / [`RunBase`, `Run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L307-L527) | `id`, `name`, `run_type`, `start_time`, `end_time`, `inputs`, `outputs`, `error`, `extra`, `serialized`, `events`, `tags`, `attachments`, `parent_run_id`, `reference_example_id`, `session_id`, `trace_id`, `dotted_order`, `manifest_id` | `child_run_ids`（deprecated）, opt-in `child_runs`, `feedback_stats`, `status`, token/cost/detail fields, `first_token_time`, `parent_run_ids`, `in_dataset`, `app_path` |
| Run v2 / generated [`Run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/run.py#L159-L370) | v1 的 execution/lineage 核心改以 `project_id`, `trace_id`, `parent_run_ids`, `reference_dataset_id`, `reference_example_id`; `status` 明确为 `SUCCESS | ERROR | PENDING`; `thread_id` 进入顶层 query model | 按 `selects` 返回 inputs/outputs/error previews、latency、token/cost/details、feedback stats、`is_root`, `is_in_dataset`, `last_queued_at`, manifest, attachment URLs, `price_model_id`, share URL、thread evaluation time |
| Feedback / [`FeedbackBase`, `FeedbackCreate`, `Feedback`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L578-L704) | `id`, `key`, `score`, `value`, `comment`, `correction`, `feedback_source`, `run_id`, `trace_id`, `session_id`, `comparative_experiment_id`, `feedback_group_id`, `start_time`, `extra`; create 另有 `feedback_config`, `extend_trace_retention`, `error` | `created_at`, `modified_at`; Run/Project 上的 `feedback_stats` 是这些 Feedback 的聚合，不取代原 Feedback |
| ComparativeExperiment / [`ComparativeExperiment`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L972-L999) | `id`, `name`, `description`, `created_at`, `modified_at`, `reference_dataset_id`, `extra`, `experiments_info` | pairwise 分数仍另存为带 `comparative_experiment_id` / `feedback_group_id` 的 Feedback |

`split` 没出现在读取用 `Example` class，并不表示它不是持久事实：create/update schema 与 Dataset API 都把它作为 Example membership 写入；读取 split 列表/筛选走 dataset endpoint。反过来，Python properties `Run.latency`、`Run.metadata`、`Dataset.url`、`TracerSession.url` 是 client-side 计算或包装，不能当作保存字段。

## 没有独立写入资源的对象

| 产品名 | 公开读取形态 | 持久性判断 |
| --- | --- | --- |
| Trace | v2 [`Trace`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/trace.py#L1-L20) 仅为 `{root_run, trace_aggregates}`；[`TraceAggregates`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/trace_aggregates.py#L1-L30) 为 `first_token_time`, `total_cost`, `total_tokens` | 写 Run，不写 Trace row；Trace 是以 `trace_id` 和 root Run 构成的 query projection |
| Thread | Run v2 的 `thread_id` 与 thread query/aggregate | 没有公开 Thread create/update resource；同 Project 根 Runs 的 grouping 形成 Thread |
| Experiment result row | v2 [`ExperimentRunQueryResponse`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/datasets/experiment_run_query_response.py#L1-L42) 为 Example 字段加 `runs: Run[]` | 是 Example↔Run join，不是第三份可写结果事实 |
| Python results handle | [`ExperimentResults`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L528-L656) 持有 iterator、queue、thread 与内存 rows | 进程退出后不能用此 class 重开历史；历史真相仍是 Project、Run、Example、Feedback |

## 写入与查询 envelope

| 操作 | 公开 endpoint / envelope | 原子性边界 |
| --- | --- | --- |
| Run start/update | `POST /runs`；`PATCH /runs/{run_id}` | 每次 HTTP resource operation；跨 start/patch、多个 Run 与 Feedback 没有公开 transaction |
| legacy batch ingest | `POST /runs/batch`，JSON `{"post": RunCreate[], "patch": RunUpdate[]}` | SDK 可按 byte limit 切成多个 request；单 request 的 datastore transaction 语义未公开。序列化见 [`combine_serialized_queue_operations`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_internal/_operations.py#L20-L218) |
| multipart ingest | multipart parts 分开承载 Run core JSON、inputs、outputs、events、extra、error、serialized 与 attachments，也可带 Feedback operation | part 命名与聚合由 SDK 实现；不能推出 ClickHouse/SmithDB record layout。实现入口见 [`_multipart.py`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_internal/_multipart.py) |
| Run v2 query | `POST /api/v2/runs/query`；request 含 cursor/time/project or reference dataset/select/filter/trace_filter/tree_filter，response 为 `{items: Run[], next_cursor}` | cursor 是读取分页，不是 resume checkpoint；没有 `selects` 时响应只保证 `id`。官方生成 resource 见 [`RunsResource.query_v2`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/runs/runs.py#L123-L257) |
| Trace v2 query | `POST /api/v2/traces/query`；response `{items: Trace[], next_cursor}` | `Trace` 在读取时由 root Run + aggregates 组成。见 [`TracesResource.query`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/traces.py#L171-L268) |
| Experiment-run v2 query | `POST /api/v2/datasets/{dataset_id}/experiment-runs`；response `{items: ExperimentRunQueryResponse[], next_cursor}` | 一页按 Example 返回其 `runs[]`；不是保存新的 result rows。见 [`ExperimentRunsResource.query`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/datasets/experiment_runs.py#L44-L135) |
| Feedback | `POST /feedback`，读取/更新/删除围绕 Feedback ID | `extend_trace_retention=true` 是写 Feedback 的副作用；Feedback 仍可独立更新/删除 |
| Project/Experiment | `POST /sessions`, `PATCH /sessions/{id}` | `reference_dataset_id` 建立实验身份，`end_time` 表示 session close；不会原子封装其 Runs/Feedback |
| Dataset/Example | Dataset 与 Example CRUD；bulk Example API 可承载 create/update/delete 集合 | SDK 会切批且可能并发；不同 request 已提交部分不回滚，见 [`Client.create_examples`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L6866-L7055) |

### Resource route 对照

下表使用 SDK 默认 `/api/v1` base 下的相对 path；`Client.create_project` 直接拼出的完整 URL 与相对 path 语义相同。

| Resource | 公开 route / method | SDK symbol / transport 注记 |
| --- | --- | --- |
| Project / Experiment | `POST /sessions`; `GET /sessions` 或 `/sessions/{id}`; `PATCH /sessions/{id}`; `DELETE /sessions/{id}` | [`create_project`, `read_project`, `list_projects`, `update_project`, `delete_project`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L5191-L5680)；Experiment 仍用同一 routes，只多 `reference_dataset_id` |
| Dataset | `POST /datasets`; `GET /datasets` 或 `/datasets/{id}`; `PATCH /datasets/{id}`; `DELETE /datasets/{id}` | [`create_dataset` 到 `delete_dataset`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L5681-L6015)；当前 Python `Client` 没有通用 update wrapper，但正式 OpenAPI 另公开 [`PATCH /api/v1/datasets/{dataset_id}`](https://docs.langchain.com/langsmith/smith-api/datasets/update-dataset)，因此 SDK method 缺席不等于服务端资源缺席 |
| DatasetVersion / tag | `GET /datasets/{id}/versions`; `GET /datasets/{id}/version`; `GET /datasets/{id}/versions/diff`; `PUT /datasets/{id}/tags` | [`diff_dataset_versions`, `update_dataset_tag`, `list/read_dataset_version`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L5831-L6159)；公开 version envelope 是 `{as_of, tags}` |
| Example | `POST /examples`; `GET /examples` 或 `/examples/{id}`; `PATCH /examples/{id}`; `DELETE /examples/{id}`；legacy bulk 为 `POST|PATCH /examples/bulk` | [`create/read/list/update/delete Example`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L6866-L7688)。若 `/info` 开启 dataset multipart，SDK 改走 dataset-scoped platform multipart endpoint；这属于 transport 兼容分支，不改变 Example identity |
| Run | `POST /runs`; `PATCH /runs/{id}`; `GET /runs/{id}`; legacy `POST /runs/query` / `/runs/batch`; v2 `POST /api/v2/runs/query`, `GET /api/v2/runs/{id}` | create/update 与 batch 的 owner 见 [`Client.create_run/update_run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L2553-L3960)；v2 只迁 query/retrieve，不替换 ingest resource |
| Trace | `POST /api/v2/traces/query`; `GET /api/v2/traces/{trace_id}/runs`（另需 `project_id`） | [`TracesResource`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/traces.py#L43-L268)；没有 Trace create route |
| Feedback | `POST /feedback`; `GET /feedback` 或 `/feedback/{id}`; `PATCH /feedback/{id}`; `DELETE /feedback/{id}` | [`create_feedback`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L8158-L8429) 与 [`update/read/list/delete_feedback`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L8431-L8548) |
| ComparativeExperiment | `POST /datasets/comparative` | [`create_comparative_experiment`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L9389-L9446)；比较评分仍写 Feedback，不内嵌在 create response |

## 物理存储：公开到什么程度

官方 [self-hosted architecture](https://docs.langchain.com/langsmith/self-hosted) 与 storage 指南只公开 datastore 职责，不公开业务表 DDL。

| 介质 | 官方可验证 owner 与内容 | 权威性 / 未公开边界 |
| --- | --- | --- |
| PostgreSQL | transactional/operational store；官方概括为 runs 之外的“almost everything”，并要求独立 `postgres` 与可选 `taskdb` 连接 | Dataset、Example、Project 等 logical resources 的 durable backend；具体 table/model 名、列、约束、事务隔离、Alembic revision 未公开，不能声称一 resource 一 table。见 [External PostgreSQL](https://docs.langchain.com/langsmith/self-host-external-postgres) |
| ClickHouse | legacy/self-hosted trace 与 Feedback ingestion/query store | Run/Trace/Feedback 高吞吐事实；DDL、partition/materialized view 与 exact primary/order key 未公开。见 [External ClickHouse](https://docs.langchain.com/langsmith/self-host-external-clickhouse) |
| SmithDB object store + metastore/taskdb | 2026 起的新 trace/feedback backend；Helm 有 ingestion/query/compaction/cluster-manager、migration 与 metastore-migration workloads | 公开 chart 能证明组件与迁移开关，不能证明对象 envelope、file name 或 user resource table。模板见 [`values.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/values.yaml#L1376-L1961) |
| Redis / Valkey | service queueing 与 caching | 可丢失/重建的运行基础设施，不是实验历史真源 |
| Blob / object storage | 默认 Run inputs、outputs、error、manifest、extra、events 在 ClickHouse；启用 blob storage 后这些大 payload 与 attachments 可放 object store，query 再 hydration | logical Run 仍是权威资源；blob 是其 payload 介质。即使 payload 外置，供检索的 token/index 内容仍可能留在 ClickHouse；完整 path grammar 与 object envelope 未公开。见 [Blob storage](https://docs.langchain.com/langsmith/self-host-blob-storage) |

官方 TTL 文档只给 operator 可配置的 retention 与 blob prefix/lifecycle 规则，不构成可由用户直接读取的文件格式；因此本研究不列想象中的 `.json`、Parquet 或 SmithDB segment 路径。详见 [Self-hosted TTL](https://docs.langchain.com/langsmith/self-host-ttl) 与 [Data purging](https://docs.langchain.com/langsmith/data-purging-compliance)。

## 权威事实、冗余、summary、index 与 cache

| 分类 | 具体数据 | 为什么这样分类 |
| --- | --- | --- |
| 权威用户/执行事实 | Example inputs/outputs/metadata/attachments；Run inputs/outputs/error/events/timestamps；Feedback score/value/comment/source；Project/Dataset identity | 用户或运行/evaluator 直接写入，丢失后不能只靠其它 summary 无损恢复 |
| 为身份与重建而持久化的冗余 | Run `trace_id`, `dotted_order`, parent/ancestor IDs, project/session ID, `reference_example_id`, v2 `reference_dataset_id`, `thread_id`; Example `source_run_id` | 其中部分可由 parent traversal、project 或 Example lookup 重新推导，但在写入/摄取时固化，保障树排序、跨存储 join、过滤与 lineage；这会让 reference 与 ordering schema 成为高兼容成本字段 |
| 服务端 summary / projection | Trace aggregates；Run/Project feedback stats；Project run count、p50/p99、cost/token totals/error rate；Dataset counts；Experiment 的 Example+`runs[]`; UI group averages | 可由权威 resources 聚合；公开 API 可返回，物理上是否 materialized/cache 未公开。它们必须被视作可重建读取结果，不能凌驾于原始资源 |
| client-side derived | `Run.latency = end_time - start_time`、URL properties、`ExperimentResults` rows；Python runner 取 examples 最大 `modified_at` 作为 `dataset_version` | 公开源码直接在读取/收尾时计算；没有独立 durable schema |
| search index | UI full-text index 只索引字段开头最多 250 characters、最短 2-character token；key/value 搜索限制最多 100 个 unique keys、每值 250 characters | 用于候选召回而非原 payload；“搜不到”不等于不存在。限制见 [Filter traces](https://docs.langchain.com/langsmith/filter-traces-in-application) |
| 本地 VCR cache | `$LANGSMITH_TEST_CACHE/<dataset_id>.yaml`；runner 的 HTTP recording 忽略 LangSmith API host | 只复用 target/evaluator 外部 HTTP，既不保存 LangSmith resources，也不是历史重开格式。实现见 [`_wrap_in_vcr`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L899-L970) |

## “可计算但仍保存”与 schema churn

LangSmith 选择在 Run 上持久化 `trace_id`、`dotted_order`、祖先 IDs、Example/Project/thread 引用，在 Run 或摄取结果上返回 token/cost/status/preview 等冗余。这避免每次查询递归树、扫描 payload 或重新定价，但任何 parentage、thread、pricing 与 projection 语义变化都需要兼容旧字段或 backfill；`dotted_order` 尤其把排序编码变成长期 wire contract。

它坚持读取时形成 Trace envelope、Experiment result row、Project/feedback/group summaries，并在 Python client 计算 latency/URLs。这样不会为每个 UI table 再制造一份 authoritative row，降低用户逻辑 schema churn；代价是 query API、aggregate 版本、索引 freshness 和 missing semantics 必须被单独治理。公开资料没有说明这些 summary 在服务端是实时计算、materialized view 还是 cache，所以只能确认其**逻辑派生性**，不能断言物理实现。

## 闭源边界

截至上述 commit/date，官方公开仓库中没有以下材料：

- LangSmith backend ORM；
- PostgreSQL migration SQL/Alembic history 与 ClickHouse DDL；
- SmithDB on-disk record schema 与 Cloud 数据库 table 清单。

Helm migration Jobs 只调用镜像内 entrypoint。因此，下列问题只能回答“未公开”：

- 每个 resource 的具体表名；
- Run/Feedback 的 exact transaction/atomic batch 语义；
- secondary/materialized index 表；
- SmithDB object file/directory/envelope；
- migration 对每列/record 的 transform。

对应可见 job 证据见 [`backend/postgres-migrations.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/backend/postgres-migrations.yaml) 与 [`backend/clickhouse-migrations.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/backend/clickhouse-migrations.yaml)。
