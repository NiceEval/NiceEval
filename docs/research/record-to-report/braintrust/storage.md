# Braintrust 的持久结构、envelope、index 与 cache

本文回答“什么被保存、以什么公开 shape 保存、什么只是派生或缓存”。执行时机与 atomicity 见 [execution.md](execution.md)，版本/兼容演进见 [schema-and-migration.md](schema-and-migration.md)。源码核对日期为 2026-08-14。

## 先分四类真相

| 分类 | Braintrust 中的实例 | 可否据此重建历史事实 |
| --- | --- | --- |
| **权威业务事实** | Experiment/Dataset/Prompt/View 等 resource metadata；ExperimentEvent、DatasetEvent、ProjectLogsEvent 的 versioned history；feedback/audit/comment；附件 object | 是，但要同时遵守 retention、delete 与版本选择 |
| **持久化派生/固化值** | Experiment 上对应的 `dataset_version`、`parameters_version`、从 `repo_info.commit` 复制的 `commit`；span 上 prompt id/version/variables provenance；Brainstore `_pagination_key` | 它们为复现、查询或排序固化，可从别的事实算出或复制，但已成为公开读 shape 的一部分 |
| **summary / projection** | Experiment comparison `ScoreSummary`/`MetricSummary`、BTQL `summary` shape、trace 聚合、diff/grade、View 对 query/display 的配置 | query 时产生；公开材料没有把一次 summary response 定义成 Experiment 的权威 snapshot |
| **index / cache** | Brainstore inverted index/row store/column store/bloom filter；PostgreSQL aggregate stats 与 object pointers；Redis；SDK prompt/parameters cache、eval span cache、`ObjectFetcher._fetchedData` | 否；丢失后应从权威 object/WAL 或 API 重建/重取 |

“持久化”不等于“权威”：Brainstore compacted segment 持久放在 object storage，却仍是原始 WAL/events 的 query index；Saved `View` 是权威的用户配置，却不保存当时的 result rows。[Self-hosted architecture：where data is stored](https://www.braintrust.dev/docs/admin/self-hosting/architecture#where-data-is-stored)

## 公开 resource 与 SDK class 对照

OpenAPI 是可核查的 wire/data-model 边界；SDK class 是 client behavior，不代表服务端 ORM class。

| 产品对象 | OpenAPI type / required identity | SDK public class/type | 持久内容要点 |
| --- | --- | --- | --- |
| Experiment container | `Experiment`: `id`, `project_id`, `name`, `public` | `Experiment`, `ReadonlyExperiment extends ObjectFetcher<ExperimentEvent>` | description/created/repo info/commit/base/dataset+version/parameters+version/metadata/tags/deletion；无 completion fields |
| Experiment row | `InsertExperimentEvent` → `ExperimentEvent` | `Span`, `ExperimentEvent`, `Experiment.log/traced/updateSpan` | input/output/expected/error/scores/classifications/metadata/tags/metrics/context；trace ids/parents/attributes；origin/comments/audit/facets |
| Production row | `InsertProjectLogsEvent` → `ProjectLogsEvent` | `Logger`, `Span` | 与 Experiment row 共用 span content，container identity 是 `project_id` + literal `log_id: "g"` |
| Dataset container | `Dataset` | `Dataset extends ObjectFetcher<DatasetEvent>` | project/name/description/created/deleted/user/tags/metadata/url slug |
| Dataset row | `InsertDatasetEvent` → `DatasetEvent` | `DatasetEvent`, `Dataset.insert/update/delete` | input/expected/metadata/tags/origin/facets；同样有 event/trace identifiers，虽通常作为 test case row 使用 |
| Dataset version alias | `DatasetSnapshot`; `Environment` + environment-object endpoints | `Dataset` selection types | Snapshot 持久 `dataset_id + xact_id`；Environment 自身和 object→version mapping 分离 |
| Prompt | `Prompt` | `Prompt` | `id`, `_xact_id`, project/org, literal `log_id: "p"`, name/slug/description, `prompt_data`, tags/metadata/function type |
| Feedback | `FeedbackExperimentItem` / dataset/log variants | `logFeedback` argument | target row `id` 加 scores/expected/comment/audit metadata/source/tags；不是独立可 list/get 的顶层 object |
| Saved view | `View` / `ViewData` / `ViewOptions` | REST generated type | object reference、view type/name，search filter/tag/match/sort 与 column/layout/group/chart choices；不含 result snapshot |
| Cross-object ingest | `CrossObjectInsertRequest` / response | SDK internal background rows | 以 object type → container id → `{events, feedback}` 映射；response 仍按 container 返回 row ids |

完整字段以同一个正式 spec 为准：[OpenAPI `Experiment`/events, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1609-L2555)、[`Dataset`/events](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L2653-L3180)、[`Prompt`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L4057-L4180)、[`View`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L8355-L8655)、[`DatasetSnapshot`/cross-object insert](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L9410-L9645)。

## Event row：稳定 identity 与版本历史

### Durable read shape

`ExperimentEvent` 的 required server fields 是 `id`, `_xact_id`, `created`, `project_id`, `experiment_id`, `span_id`, `root_span_id`。`ProjectLogsEvent` 对应 `org_id/project_id/log_id`，`DatasetEvent` 对应 `project_id/dataset_id`。可选 `span_parents` 构 DAG，`is_root`/`span_attributes` 提供显示语义。[OpenAPI `ExperimentEvent`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L2223-L2490)

四个 id 不能互换：

- `id`：一条持久 row 的 stable identity，也是 permalink、feedback/update target；
- `_xact_id`：处理该 network insertion 的 transaction id，单调递增；同一 `id` 的多次 version 各有自己的 value；
- `span_id`：trace DAG 内的节点 id，`span_parents` 引用它；
- `root_span_id`：把全 trace 聚在一起的 id。

官方说明在 native SDK 中 `id` 与 `span_id` 通常不同；部分 OpenTelemetry integration 会令它们相同。UI/API 查特定 span 应用 `id`，查 whole trace 用 `root_span_id`。[Identify spans and traces](https://www.braintrust.dev/docs/observe/filter#identify-spans-and-traces)

`_pagination_key` 是 Braintrust 自动生成的稳定 time-order key，并且 OpenAPI 明说只存在于 Brainstore。它服务 pagination/index，不是用户业务事实；SDK 不应制造它。[OpenAPI `ProjectLogsEvent._pagination_key`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1175-L1215)

### Write shape 与 merge controls

`InsertExperimentEvent`/`InsertDatasetEvent` 可省略 server fields，并有四组版本化 mutation controls：

- `_object_delete: true` 追加删除版本，后续普通 fetch 不再显示该 object；
- 默认同 id 新 row 完全 replacement；`_is_merge: true` 才 deep merge；
- `_merge_paths` 指定哪些 subtree 到此停止 deep merge、改为 replacement；
- `_array_delete` 从指定 array path 删除具体 values。

deprecated `_parent_id` 不应再保存；producer 要显式给 `span_id/root_span_id/span_parents`。这些 controls 说明公开 event store 不是“只允许追加新 id”：它保留 append-only version history，同时把某一 version 投影成当前 row。[OpenAPI `InsertExperimentEvent`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1870-L2222)

REST 单容器入口是 `POST /v1/experiment/{experiment_id}/insert`、dataset/project-logs 对应 routes；`POST /v1/insert` 接收 `CrossObjectInsertRequest`。insert response 的 `row_ids` 和 input events 1:1 对齐，但没有 commit token 表示整个 Experiment 完成。[OpenAPI experiment event endpoints, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L12670-L12940)

SDK 实际 background ingest envelope 比 public per-resource body再包一层：

```json
{"rows": [/* merged cross-object rows */], "api_version": 2}
```

`constructLogs3Data()` 生成它并 POST private-but-publicly-visible SDK route `logs3`；超大 body 可以变成 `{rows:{type,key},api_version:2}` overflow reference。这里的 `api_version: 2` 是 ingest envelope version，不是 event `_xact_id` 或 OpenAPI document version。[`constructLogs3Data`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L2774-L2805)

### Object reference 只保存 pointer

`ObjectReferenceNullish` required fields 是 `object_type`, `object_id`, `id`，可选 source `_xact_id/created`。它能指向 `project_logs`, `experiment`, `dataset`, `prompt`, `function`, `prompt_session`；引用本身不 copy source payload，也不保证 source 在 retention/delete 后仍可读。[OpenAPI `ObjectReferenceNullish`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L760-L794)

## Dataset 与 Prompt 的版本化保存

Dataset 的版本不是 container 上一列自增整数，而是 event log 的 concrete transaction snapshot。每次 row mutation 推进 head；SDK 的 `ObjectFetcher.version()` 在没有 pinned version 时遍历可读 rows，取最大 `_xact_id`。

`DatasetSnapshot.xact_id` 固定到它，Environment mapping 则可移动。Experiment 注册时保存对应的 `dataset_id + dataset_version`，因此以后 snapshot/environment 改动不改变既有 Experiment 的输入 provenance。[`ObjectFetcher.version`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L6885-L7077)；[Dataset versions contract, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/features/dataset-versions/README.md)

Prompt row 的 `_xact_id` 同时是 `Prompt.version`。`prompt_data` 保存 template/model/options/parser/tool-function references；`Prompt.build()` 才在调用者进程 render template。为可追溯，compiled request 的 `span_info.metadata.prompt` 又保存 `id`, `project_id`, concrete `version` 与 variables。

这是有意的数据重复：不必重演“当前 prompt/environment”就能解释某次 LLM span。[`Prompt` / `runBuild`, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L8991-L9170)

## Physical storage：公开到什么粒度

Braintrust 官方 self-host architecture 把 object storage 定义成 AI data 的 durable source of truth。Brainstore writer 追加 WAL，后台产生 time-ordered/compacted indexed segments。reader 查询时合并尚在 WAL、已处理但未 compact 的数据与 indexed data。因而 local NVMe 与 reader cache 不拥有事实。[Self-hosted architecture：Brainstore](https://www.braintrust.dev/docs/admin/self-hosting/architecture#brainstore)

| 物理 component | 已公开保存内容 | 分类 |
| --- | --- | --- |
| S3/GCS/Azure object storage | Brainstore WAL、processed/compacted index segments、AI payload；附件也使用 object storage | WAL/object 为 authority；segment/index 为 rebuildable persisted projection |
| PostgreSQL | platform metadata、object-storage pointers、aggregate statistics | metadata 中有 authority；pointer/aggregate 是 lookup/loading；公开材料没有逐表分类 |
| Redis | cache、coordination、rate/session state、Brainstore transaction-id assignment | cache/coordination；不是 durable history |
| Brainstore node local NVMe | reader/writer runtime cache/work area | ephemeral cache；Terraform 明确要求 local NVMe，但不把它当 source of truth |

官方 Terraform 的具体文件能确认 infrastructure resource，但不能代表 DB model。`modules/storage/s3-brainstore.tf` 创建 Brainstore bucket。`modules/brainstore-ec2/main-writer.tf`、`main.tf`、`main-fast-reader.tf` 部署角色分离的 binaries。binary 来自 versioned artifact/image，engine 源码未公开。[Terraform AWS data plane, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/tree/cf5ed695727363877296a1d37c7876e3a9a4d969/modules)

公开仓库没有 PostgreSQL table name、DDL、ORM model/class、foreign key、index definition 或 event→table mapping。`aws_lambda_function.migrate_database` 是部署资源名，不是 schema；不得从 Terraform resource 猜 `experiments`/`events` 等内部 table。服务端 migration 边界见 [schema-and-migration.md](schema-and-migration.md#服务端数据库-migration公开了触发器没有公开内容)。

## Client-side files 与 memory caches

| 路径 / representation | owner 与 envelope | 权威性 / 生命周期 |
| --- | --- | --- |
| `~/.braintrust/prompt_cache/<hash>` | JS SDK `DiskCache<Prompt>`；key hash 作 filename，content 是 gzip-compressed JSON，mtime 实现 LRU | derived cache；API row 才是 authority；可删、可因容量淘汰 |
| `~/.braintrust/parameters_cache/<hash>` | 同一 `DiskCache<RemoteEvalParameters>` machinery | derived cache |
| OS temp `/.../braintrust-span-cache-<timestamp>-<random>.jsonl` | `SpanCache`; 每行 `{rootSpanId, spanId, data: CachedSpan}`，append；read 时按 spanId merge | eval scorer 的 process-local acceleration，不上传、不替代 server spans |
| `ObjectFetcher._fetchedData` | JS heap array；`fetchedData()` 填充，`clearCache()` 清除 | 一次 object wrapper 的 local memoization |
| failed/all publish payload directory | 用户由 `BRAINTRUST_FAILED_PUBLISH_PAYLOADS_DIR` / `BRAINTRUST_ALL_PUBLISH_PAYLOADS_DIR` 指定；JSON 包含 logs3 data + attachment debug info | diagnostics/recovery material，不是 server receipt；可能含敏感数据 |

Prompt/parameters disk-cache 实现见 [`DiskCache`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/prompt-cache/disk-cache.ts)；默认目录在 [`BraintrustState` constructor](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L760-L825)。Prompt 的 explicit version/environment lookup 失败时不会使用本地旧 cache；只有 latest lookup 可以按 cache mode fallback，详见 [schema-and-migration.md](schema-and-migration.md#prompt-reader-与-cache-compatibility)。

`SpanCache` 只在 eval 开启，browser 无 filesystem 时退化为 no-op。源码意图是 eval 完成 `dispose()` 删除。但核对的 commit 中，`runEvaluatorInternal` 先 `dispose()` 再 `stop()`。`dispose()` 在 active count > 0 时立即返回，所以单次正常 eval 通常要等注册的 process-exit handlers 才真正删除 temp file。这不改变它的 cache 身份，但意味着不能假定 `Eval()` 返回时文件已消失。[`SpanCache`, `js/src/span-cache.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/span-cache.ts#L1-L355)；[`runEvaluatorInternal` cleanup](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L1680-L1690)

## 哪些本可计算却保存，哪些坚持读取时计算

### 有意持久化

- `Experiment.commit` 明确取自 `repo_info.commit`；重复保存降低常用 filter/query 成本。
- concrete `dataset_version`、`parameters_version` 把运行时 resolution 结果冻结，避免 alias 后移造成复现漂移。
- prompt provenance 在 Prompt row 已有 id/version 后仍复制到 execution span，并保存 variables；它保护运行历史不受 Prompt head 改变影响。
- `_pagination_key`、compacted column/row stores、inverted index/bloom filter、PostgreSQL aggregate stats 可由 event/object 重建，却为 pagination/query latency 持久保存。
- Snapshot/Environment mapping 虽是短 pointer，仍是用户命名与 promotion decision 的权威事实，不能只由 head 猜回。

### 读取时计算

- `ObjectFetcher.version()` 在未 pinned 时扫描 rows 取 max `_xact_id`；
- BTQL trace/summary shape、score/metric aggregate、group/pivot、Experiment `summarize()` comparison、diff/grade 都从 rows 与 baseline 计算；
- parent span 的聚合 duration/cost/score display、多人 review average 是读取 projection，原 child/review spans 保留；
- Prompt template render 在 SDK `build()` 发生；translation 显示也不回写原 log。[Translate message content](https://www.braintrust.dev/docs/observe/examine-traces#translate-message-content)
- Saved View 只持久 query/display config，每次打开重新 query。

这个取舍把 schema churn 集中在两个位置：长期兼容压力落在通用 event fields、version ids 与 provenance pointer；comparison/UI 算法可以演进而不重写每条历史 event。代价是派生 query 的结果可能随引擎版本变化，且公开 API 没有“某次 report projection 的 schema/version snapshot”。若消费者需要可审计的固定报告，不能把一次 UI summary 当作已保存事实。
