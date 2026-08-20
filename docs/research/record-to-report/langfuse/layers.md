# Langfuse layers、component 与依赖

> 观察日期：2026-08-14
>
> 核对源码：`langfuse/langfuse` `7cc6d2c0`
>
> 返回 [目录](README.md)

本页只写产品自己的层、组件、资源与依赖。
一次请求或实验怎样跑完见 [execution.md](execution.md)。
表与信封见 [storage.md](storage.md)。

## 产品面

官方 README 与文档站目录给出的具名面：

| 具名面 | 用户把它当成什么 | 官方入口 |
|---|---|---|
| Observability | 一次请求里的步骤树 | [Core Concepts](https://langfuse.com/docs/observability/data-model) |
| Evaluation | 给已有对象补判断 | [Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model) |
| Datasets / Experiments | 固定题集上的一次执行快照 | [Experiments Data Model](https://langfuse.com/docs/evaluation/experiments/data-model) |
| Metrics / Dashboards | 读时聚合与 Widget 布局 | [Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards) |
| Public API | 读写契约 | [api.reference.langfuse.com](https://api.reference.langfuse.com) |
| Prompt Management | 中心化 prompt 版本 | 官方 README；本方向不展开 |
| Playground | 从坏结果跳去改 prompt | 官方 README；本方向不展开 |

这些面共享同一套 Web / Worker / 存储，不是五套独立产品。

## 运行时组件

官方架构把运行时拆成两套应用容器和四类存储。
见 [Architecture handbook](https://langfuse.com/handbook/product-engineering/architecture) 与仓库 [`CONTRIBUTING.md`](https://github.com/langfuse/langfuse/blob/7cc6d2c0b925c282021fdea11176066927ca4ab3/CONTRIBUTING.md) 的 Network Overview。

```text
用户进程（应用或 Experiment runner）
    → Web（Next.js UI + Public REST + tRPC）
Web
    → S3 / Blob（原始 ingestion 事件、媒体）
    → Redis / Valkey（BullMQ 队列、API key / Prompt 缓存）
    ↔ Postgres（事务对象）
    ← ClickHouse（观测分析）
Redis / Valkey
    → Worker（队列消费、回填、评测执行）
Worker
    ↔ S3 / Blob
    → Postgres
    → ClickHouse
```

v4 不引入新服务。
见 [What does not change](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4)。

## 仓库包与依赖方向

入口写在 [`AGENTS.md`](https://github.com/langfuse/langfuse/blob/7cc6d2c0b925c282021fdea11176066927ca4ab3/AGENTS.md)：

| 目录 | 职责 |
|---|---|
| `web/` | UI、tRPC、Public REST |
| `worker/` | 队列消费者与后台任务 |
| `packages/shared/` | 领域类型、Postgres schema、ClickHouse schema、队列契约 |
| `fern/apis/server/definition/` | Public API 的 Fern 源 |
| `ee/` | 企业包，被 `web` 消费 |

依赖只允许：`web` → `@langfuse/shared` 与 `@langfuse/ee`；`worker` → `@langfuse/shared`；`@langfuse/ee` → `@langfuse/shared`。
`@langfuse/shared` 不得引用 `web`、`worker` 或 `ee`。

队列 payload 与队列名的唯一入口是 `packages/shared/src/server/queues.ts`。
领域 type 与表形的逐项证据集中在 [storage.md](storage.md)，本页不重复列出。

## 资源与 owner

| 资源 | Owner | 其它组件怎样引用它 |
|---|---|---|
| Observation / Trace 事件 | 用户进程写出；Web `processEventBatch` 接收；Worker `IngestionService` 入库 | 靠 `trace_id` / `span_id` 互指 |
| Score | 用户 SDK、平台 evaluator 或人评写入；Worker 写入 `scores` | 恰好引用 Trace、Observation、Session 或 DatasetRun 之一 |
| Dataset / DatasetItem / DatasetRuns | Web 或 SDK 经 Public API 写 Postgres | DatasetRunItem 用 `datasetId`、`datasetItemId`、`datasetRunId` |
| DatasetRunItem | Worker 摄入 `dataset-run-item-create` | 指向一条 Trace，可选 Observation |
| Media 字节 | Web `POST /api/public/media` + 客户端 presigned 上传 | Observation / DatasetItem JSON 只留 token |
| Dashboard / Widget 声明 | Web UI 或 unstable API 写 Postgres | Widget 引用 view / dimension / measure，不引用图表渲染器 |
| JobConfiguration / JobExecution | Web 配置；Worker 执行 | Execution 指向被评 Trace / Observation / DatasetItem，以及写出的 Score |
| BackgroundMigration 行 | Worker `backgroundMigrationManager` | 只改存储，不改变公开对象身份 |

Handbook 写明：正常 ingestion 路径通过 Redis 传 S3 引用，不传完整 payload。
见 [Data Ingestion from SDKs](https://langfuse.com/handbook/product-engineering/architecture)。
S3 上传失败时的 Redis fallback 见 [execution.md](execution.md#接收web)。

## 对象之间的引用

官方 [Core Concepts](https://langfuse.com/docs/observability/data-model) 与 [Experiments Data Model](https://langfuse.com/docs/evaluation/experiments/data-model) 给出的关系：

```text
Session 1 ── n Trace
Trace     = 共享 trace_id 的 Observation 集合
Observation 可嵌套（parentObservationId）
Score ── 恰好一个 {Trace | Observation | Session | DatasetRun}
Dataset 1 ── n DatasetItem
Dataset 1 ── n DatasetRun
DatasetRun 1 ── n DatasetRunItem
DatasetRunItem 1 ── 1 DatasetItem
DatasetRunItem 1 ── 1 Trace
DatasetRunItem 0..1 Observation
DatasetItem.sourceTraceId / sourceObservationId  ── 生产 Observation（lineage）
```

Fern `Experiment.id` 的文档写：dataset run ID (experiment ID)。
路径：`fern/apis/server/definition/experiments.yml`。
公开读取面叫 Experiment；Postgres 模型仍叫 `DatasetRuns`。

本地数组实验只产生 Trace 与 Score，不产生 DatasetRun。
见 [Local Datasets](https://langfuse.com/docs/evaluation/experiments/data-model#local-datasets)。
