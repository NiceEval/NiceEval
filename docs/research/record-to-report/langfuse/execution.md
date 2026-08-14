# Langfuse 执行顺序：请求、实验、失败与 resume

> 观察日期：2026-08-14
>
> 核对源码：`langfuse/langfuse` `7cc6d2c0`；`langfuse-python` `73b5c028`
>
> 返回 [目录](README.md)

本页写真实顺序与每一步的 owner。
组件归属见 [layers.md](layers.md)。
写入落点见 [storage.md](storage.md)。

本次核对的官方文档与服务端仓库没有与 `dataset.run_experiment()` 对等的产品 CLI。

## 路径总表

| 发起面 | 谁调度 | 谁执行用户逻辑 | 是否产生 DatasetRun |
|---|---|---|---|
| SDK / OTel 观测 | 用户进程本地批量，再 POST | 用户应用 | 否 |
| `dataset.run_experiment(...)` | 用户进程 `asyncio` + semaphore | 用户 `task` | 是 |
| `langfuse.run_experiment(data=本地数组)` | 同上 | 用户 `task` | 否，只有 Trace 与 Score |
| UI Prompt Experiment | Worker `ExperimentCreate` 队列 | Worker 调 LLM | 是 |
| OTel experiment 属性 | 用户进程 | 用户应用 | 靠 `experiment_*` 列重建 |
| Dataset `remoteExperimentUrl` | Web 发 webhook | 外部系统 | 由外部决定 |
| GitHub Action [`experiment-action`](https://github.com/langfuse/experiment-action) | CI | 用户脚本 | 若脚本走 Dataset runner，则是 |
| `POST /api/public/dataset-run-items` | 调用方 | 调用方 | 兼容旧 SDK；v4 不得作为新写入 |

## A. 一次请求的观测写入

官方 [Background Processing](https://langfuse.com/docs/observability/data-model#background-processing) 写明：SDK 不在创建当下同步发送。

```text
1. 发起   用户请求进入应用
2. 执行   start_as_current_observation / @observe / OTel span
3. 缓冲   SDK 入本地队列（非阻塞）；应用返回响应
4. 发送   后台 exporter 批量 POST /api/public/otel/v1/traces
5. 接收   Web processEventBatch 校验、写 S3、把引用推进 Redis
6. 入库   Worker IngestionService 合并、补全 usage/cost、写 ClickHouse
7. 完成   各 span 已 end，且进程 flush()，且 Worker 已写完对应 S3 对象
```

### 发起与执行（用户进程）

Context manager 退出时自动结束：

```python
from langfuse import get_client

langfuse = get_client()
with langfuse.start_as_current_observation(as_type="span", name="process-request") as span:
    span.update(output="Processing complete")
langfuse.flush()
```

一手材料：[SDK overview](https://langfuse.com/docs/observability/sdk/overview)。

手动 Observation 必须显式 `.end()`。
不调用 `.end()` 会得到不完整或缺失的 Observation。
见 [Instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation#manual-observations)。

短生命周期进程必须在退出前 `flush()`。
否则缓冲区里的 Trace 会丢失。

Python SDK 把 OTel 整数 `trace_id` 格式化成 32 位小写十六进制。
符号：`Langfuse._format_otel_trace_id`，文件 `langfuse/_client/client.py`。

请求过程中、`flush()` 之前更新 span 的 output，属于正常用法。

### 接收（Web）

v4 默认写入是 `POST /api/public/otel/v1/traces`。
见 [OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry)。

`processEventBatch` 是写入入口。
路径：`packages/shared/src/server/ingestion/processEventBatch.ts`。

1. 用 `createIngestionEventSchema` 校验；失败的事件进 `errors`，不阻断整批。
2. 按 `entityType-eventBodyId` 分组。
3. 把同组事件写成一个 JSON，上传到 S3。
4. 把 S3 引用推进 `IngestionQueue`。

S3 上传是 blocking but non-failing。
上传失败会记日志，并把整批改走 Redis 队列，不向调用方抛错。

队列名与 payload 分工见 [storage.md](storage.md#redis--valkey)。

### 入库（Worker）

`IngestionService.mergeAndWrite` 按实体分流。
路径：`worker/src/services/IngestionService/index.ts`。

| `eventType` | 处理函数 | 默认写入表 |
|---|---|---|
| `trace` | `processTraceEventList` | `traces`；v4 还可造虚拟 root span |
| `observation` | `processObservationEventList` | `observations` 或 staging；v4 转 `events_full` |
| `score` | `processScoreEventList` | `scores` |
| `dataset_run_item` | `processDatasetRunItemEventList` | `dataset_run_items_rmt` |

v4 直接写宽表的路径是 `createEventRecord` → `writeEventRecord`。
`writeEventRecord` 注释写明：只写 `events_full`，materialized view 自动填充 `events_core`。

同一实体的多次事件用 `mergeRecords` + `overwriteObject` 合并。
不可变键包括 `id`、`project_id`、`trace_id`、`start_time`、`created_at`、`environment`。
`event_ts` 在合并结束时改成当前时间，供 `ReplacingMergeTree` 取最新行。

`ClickhouseWriter` 按表批量 flush。
失败按 `LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS` 重试。
路径：`worker/src/services/ClickhouseWriter/index.ts`。

### 完成与不可更新

Observability 没有名为 Run 的公共写入对象，也没有服务端 seal。

完成靠三件事同时成立：

1. 每个手动 Observation 已 `.end()`，或 context manager 已退出。
2. 进程调用了 `flush()`，缓冲区已空。
3. Worker 已把对应 S3 对象写入 ClickHouse。

`end_time` 为空只表示该 Observation 尚未结束，不是整条 Trace 的完成标志。

官方 [Tracing data updates](https://langfuse.com/faq/all/tracing-data-updates) 写明：已摄入的 Trace 与 Observation 不可靠更新。
v4 读取路径不按 `id` 去重。
用同一 `id` 再发送会制造重复行，并抬高 `sum(totalCost)`。

后补信息走 Score，见下一节。

## B. 一次 Dataset 实验

官方推荐面：[Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)。

`Dataset.run_experiment` 把 `self.items` 交给 `Langfuse.run_experiment`。
路径：`langfuse/_client/datasets.py`。

`Langfuse._run_experiment_async` 的顺序如下。
路径：`langfuse/_client/client.py`。

```text
1. 发起   调用方给 name；run_name 给定或 name + ISO 时间戳
2. 调度   asyncio.Semaphore(max_concurrency=50) 并发每个 item
3. 执行   observation "experiment-item-run"
          └─ "experiment-item-task" 调用户 task
          └─ "experiment-item-evaluation" 调 evaluator（as_type="evaluator"）
4. 写入   Dataset item 则 api.dataset_run_items.create(...)
          成功的 evaluator 调 create_score(trace_id, observation_id=task_span.id)
5. 汇总   跑 run_evaluators；结果 create_score(dataset_run_id=...)
6. 完成   flush()；返回客户端 ExperimentResult
```

若 item 来自 Langfuse Dataset，创建 DatasetRunItem 时带：
`run_name`、`dataset_item_id`、`trace_id`、`observation_id=task_span.id`、可选 `dataset_version`。
这一步创建或复用 Postgres `DatasetRuns`，并写入 ClickHouse DatasetRunItem。

`ExperimentResult` 字段：`name`、`run_name`、`item_results`、`run_evaluations`、`experiment_id`、`dataset_run_id`、`dataset_run_url`。
路径：`langfuse/experiment.py`。

`dataset_run_url` 是客户端拼出的 UI 深链，不是服务端完成回执。
深链形状与重开入口见 [reading-and-comparison.md](reading-and-comparison.md#重开入口)。
Postgres `DatasetRuns` 没有 status 列。
Experiments API 的 `startTime` / `endTime` 是查询时间范围内的派生值，见 [reading-and-comparison.md](reading-and-comparison.md)。

Score 写入面：`POST /api/public/scores`、`Langfuse.create_score`、`span.score` / `span.score_trace`。
见 [Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)。

Score 替换键是 `id` + `name` + `toDate(timestamp)`。
三者同时匹配才替换，否则得到另一条 Score。
见 [Updating scores](https://langfuse.com/faq/all/tracing-data-updates#updating-scores)。
源码 `upsertScore` 要求 `id`、`project_id`、`name`、`timestamp` 都在。
路径：`packages/shared/src/server/repositories/scores.ts`。

部分字段合并已 deprecated。
最多在创建后 30 天内，同 `id` 的再摄入可能回填未给字段。
官方要求不要再依赖该行为。

## C. UI Prompt Experiment

Worker `experimentServiceClickhouse.ts` 处理 `ExperimentCreate` 队列。

对每个 Dataset item：

1. `traceId = createW3CTraceId("${runId}-${datasetItem.id}")`。
2. 先 `processEventBatch` 一条 `dataset-run-item-create`。
3. 在 Worker 内调用 LLM。
4. 成功后把 `DatasetRunItemUpsert` 推进 Redis，供异步 evaluator 使用。

`getExistingRunItemDatasetItemIds` 先查 `dataset_run_items_rmt`。
已存在的 `dataset_item_id` 会被跳过。
这是 Prompt Experiment 的 resume 面。

LLM 失败返回 `{ success: false }`，不阻断其余 item。
`dataset-run-item-create` 失败只记日志。

v4 新实验数据应走 Experiment runner，或给 OTel span 加上 experiment 属性。
见 [Experiment instrumentation](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#experiment-instrumentation)。

`POST /api/public/dataset-run-items` 在 Fern 上标 deprecated。
文档写：v4 上它只返回供旧客户端兼容的 object，不得用于新写入。

## D. 平台评测 JobExecution

用户函数评测没有服务端 status。
平台拥有的 LLM-as-a-Judge 与 code evaluator 有。

`JobConfiguration` 描述规则；`JobExecution` 是一次执行。

| `JobExecutionStatus` | 含义 |
|---|---|
| `PENDING` | 已创建，未跑完 |
| `DELAYED` | 等待 `delay` |
| `COMPLETED` | 已写出 Score |
| `ERROR` | 失败，`error` 有文案 |
| `CANCELLED` | 取消 |

`jobOutputScoreId` 指向写出的 Score。
`executionTraceId` 指向 Judge 自己的 Trace。

这些任务使用的 Redis 队列集中列在 [storage.md](storage.md#redis--valkey)。

v4 要求把 Trace 级 evaluator 迁到 Observation 级。
`events_only` 之后，旧 Trace 级 evaluator 停止运行。
见 [Evaluations](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#evaluations)。

## 失败、partial、retry、resume

| 场景 | owner | 行为 |
|---|---|---|
| 单个 task 抛错 | SDK | item span 标 ERROR，实验继续 |
| evaluator 抛错 | SDK | 记日志，其它 evaluator 继续 |
| 写 Score 失败 | SDK / Worker | 记日志，不回滚 Observation |
| 创建 DatasetRunItem 失败 | SDK / Worker | 记日志；该 item 仍有 Trace |
| Prompt Experiment 重跑同 `runId` | Worker | 已有 `dataset_item_id` 被跳过 |
| 同名 DatasetRun | Postgres | `@@unique([datasetId, projectId, name])` |
| 短进程未 `flush()` | 用户进程 | 缓冲区丢失 |
| 单批里部分事件校验失败 | Web | 失败进 `errors`，其余继续 |
| S3 上传失败 | Web | 改走 Redis；调用方仍可能看到成功 |
| ClickHouse 写入失败 | Worker | `ClickhouseWriter` 按 `maxAttempts` 重试 |
| DatasetRun 或 DatasetItem 找不到 | Worker | `processDatasetRunItemEventList` 返回空，事件丢掉 |
| 已摄入 Observation 再发同一 `id` | 调用方 | v4 产生重复行，不是更新 |
| S3 上已有 ingestion JSON | 运维脚本 | `replayIngestionEvents` / `replayIngestionEventsV2` 再读再写 |

没有跨 Observation、Score、DatasetRunItem 的原子提交。
本次检查的一手公开面未提供 Experiment 级 receipt。
