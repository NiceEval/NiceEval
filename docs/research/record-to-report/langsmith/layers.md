# LangSmith 的原生 layer、component 与 resource

本页只回答 LangSmith 自己怎样命名产品边界、谁拥有资源、资源怎样引用。执行时序见 [execution.md](execution.md)，字段和物理介质见 [storage.md](storage.md)。源码固定核对官方 `langchain-ai/langsmith-sdk` commit [`345a522`](https://github.com/langchain-ai/langsmith-sdk/commit/345a52252af163abe33699fb361038f5783c9024)（2026-08-13 UTC）。

## 产品面

| LangSmith 产品面 | 具名资源 / 视图 | 产品 owner | 依赖与边界 |
| --- | --- | --- | --- |
| Observability | Project、Trace、Run、Thread、Feedback；Tracing UI 的 Threads / Traces / Runs 与 Messages / Turns / Details | 应用 instrumentation / SDK 产生 Run；LangSmith ingestion 与 query 服务保存和投影；UI 呈现 | Project 包含 Trace；Trace 是 Run tree；Thread 需要 Run metadata 的 `thread_id`；Feedback 可挂 Run、Trace/Thread 语义或 Project。官方对象定义见 [Observability concepts](https://docs.langchain.com/langsmith/observability-concepts) |
| Datasets | Dataset、Example、DatasetVersion、split、attachment | 用户或 dataset API 写 Example；Dataset resource 拥有 examples | Example 可从 Run 提取并以 `source_run_id` 保留 lineage；版本是 `as_of` 时间视图与可移动 tag，不是独立内容对象。公开 schema 见 [`Dataset` / `Example`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L82-L300) |
| Offline evaluation | Experiment、target、row evaluator、summary evaluator、ExperimentResults | SDK/UI runner 调 target 与 evaluator；服务端只接收 Project、Run、Feedback 等资源 | Experiment 在 API 中就是引用 Dataset 的 `TracerSession`；target 产 Run，evaluator 产 Feedback。本地 `ExperimentResults` 不拥有服务端持久结果资源 |
| Comparative evaluation | ComparativeExperiment、pairwise evaluator、comparative Feedback | comparative runner 创建比较容器并写成组 Feedback | 所有被比较 Experiment 必须引用同一 Dataset；`comparative_experiment_id` 定义比较，`feedback_group_id` 定义同一 Example 上的一组偏好 |
| Human evaluation / evaluator alignment | Annotation Queue、human Feedback、Evaluator Playground、alignment score | 人类 reviewer 写 Feedback；Evaluator Playground 执行 judge | Align Evaluator 把选中的 Run 送入 annotation queue，以人工标签为参照测试 judge；官方流程见 [Improve LLM-as-judge evaluators](https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback) |

这里的“layer”是 LangSmith 的产品功能面，不暗示一次执行必须按这些面分阶段。

## Resource 身份、owner 与引用

| Resource | 公开身份与 owner | 出边 | 入边 / 依赖 |
| --- | --- | --- | --- |
| `Dataset` | `Dataset.id`; dataset API 创建、更新、删除 | contains `Example`; associated experiments | Experiment 的 `reference_dataset_id` |
| `Example` | `Example.id`; dataset API 写入；`modified_at` 参与时间版本 | `dataset_id`; 可选 `source_run_id` | Run 的 `reference_example_id`；experiment-run query 的行键 |
| `Project` / `TracerSession` | `TracerSession.id`; project/session API owner；UI 称 Project | contains runs；可选 `reference_dataset_id` | Run 的 `session_id`（旧 schema）或 `project_id`（v2 schema） |
| `Experiment` | 没有独立公开 class；是 `reference_dataset_id != null` 的 Project/Session | Dataset；Experiment Runs；summary Feedback | Dataset 的 Experiments tab、ComparativeExperiment |
| `Run` | `Run.id`; instrumentation / caller 选择 UUID，Run API 接收 | `trace_id`、project/session、reference Example、parent/ancestors、Feedback | Trace、Thread、Experiment 的共同事实单元 |
| `Trace` | 写入面没有独立 create resource；根 Run 的 `id == trace_id`，v2 query 返回 `Trace{root_run, trace_aggregates}` | child Runs、Thread | Project；Run tree。公开结构见 [`Trace`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/trace.py#L1-L20) |
| `Thread` | 没有独立写入；同一 Project 下由根 Run 的 `thread_id` 聚合 | Traces、thread-level aggregate | 缺 `thread_id` 就不存在 Thread/Turns 产品视图；见 [View traces](https://docs.langchain.com/langsmith/view-traces) |
| `Feedback` | `Feedback.id`; evaluator、人类或 API 写入 | Run/trace、Project、comparative experiment/group；可指 judge `source_run_id` | 行级、summary、pairwise 评分都复用它 |
| `ComparativeExperiment` | 独立 `id`; `/datasets/comparative` 创建 | `reference_dataset_id`、experiment IDs / `experiments_info`、comparison Feedback | Dataset 的 Pairwise Experiments / comparison view |
| `ExperimentResults` | Python 本地 class，由 iterator、queue、thread 与内存 list 拥有 | `ExperimentResultRow{run, example, evaluation_results}` | 不可作为服务端 durable resource 重开；源码见 [`ExperimentResults`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L528-L656) |

关键边界是：**Trace、Thread、Experiment 与 result table 都是建立在 Run 及引用之上的产品概念，但只有 Experiment 复用一个可写 Project/Session resource；其余不能被臆测成同名数据库表。**

## 用户入口与控制面

| 入口 | 拥有的职责 | 不拥有的职责 |
| --- | --- | --- |
| UI / Playground / Studio | 选择 Dataset、target/deployment 与 evaluator；后台发起实验；展示进度、Trace 和比较结果 | 官方没有公开 UI 服务端调度器、事务或内部 job schema |
| Python / TypeScript SDK | instrumentation、`evaluate` / `aevaluate` 本地 orchestration、资源 client、批量摄取、query adapter | `ExperimentResults.wait()` 不代表服务端索引或全局 commit |
| REST API | Project/Session、Run、Feedback、Dataset、Example、ComparativeExperiment 的资源边界 | caller 必须自己维护 parent-child、Example/Session 引用与结束时间；见 [REST experiment guide](https://docs.langchain.com/langsmith/run-evals-api-only) |
| LangSmith CLI | typed query/management、export，以及 `langsmith api` 原始 REST 包装 | typed commands 有 `experiment list/get`，没有通用的 typed `experiment run`；发起需 SDK/UI 或 raw API。命令清单见 [LangSmith CLI](https://docs.langchain.com/langsmith/langsmith-cli) |

## Self-hosted 运行组件

官方 [Self-hosted overview](https://docs.langchain.com/langsmith/self-hosted) 给出的部署组件不是对象模型，而是对象流经的服务边界：

| Component | owner / 职责 | 上游 | 下游依赖 |
| --- | --- | --- | --- |
| LangSmith frontend | Nginx 提供 UI、路由 API；唯一必须暴露给用户的入口 | 浏览器、SDK/API caller | backend、platform backend、Playground 等 |
| LangSmith backend | 主要 CRUD 与业务逻辑；预处理 trace ingestion | frontend、SDK | queue、PostgreSQL、trace/feedback store |
| LangSmith platform backend | auth、run ingestion 与其它高吞吐任务 | frontend / API | ingestion 与 storage services |
| LangSmith queue | 异步接收 Trace / Feedback，做完整性检查、数据库错误 retry，直到写入 trace/feedback store | backend / platform backend | Redis/queue state、ClickHouse 或 SmithDB ingestion |
| Playground | 转发模型请求、支持 Playground 实验 | UI | 外部模型 API、tracing/evaluation resources |
| ACE backend | 任意代码执行产品能力 | evaluator / deployment 功能 | 官方未公开其评测持久化内部结构 |
| ClickHouse / SmithDB | Trace / Feedback 的高吞吐 ingestion 与 query backend | queue / platform backend | query APIs；迁移期可 dual ingest |
| PostgreSQL | transactional / operational resources；官方称“almost everything besides runs” | backend | Project、Dataset 等具体 table 未公开 |
| Redis / Valkey | queueing 与 caching | services | 非 durable truth |
| Blob / object storage | 可选大 payload 与 attachment 介质；SmithDB 也配置 object store | ingestion | query hydration、retention lifecycle |

Helm chart 把 SmithDB workload 细分为 `query`、`ingestion`、`compaction`、`compactionWorker`、`clusterManager`、`migration` 与 `metastoreMigration`。这些是服务组件，不等同于用户 API resources。公开模板见官方 Helm [`values.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/values.yaml#L1376-L1961)。

## 不可越过的公开边界

- LangSmith Cloud 与主后端不是开源产品；公开 SDK models 只能证明 wire/resource schema，不能证明表名、列、主键、transaction isolation 或内部 materialized view。
- Helm 开源仓库证明 workload、开关与 migration job 的编排，但 SQL、Alembic revision、ClickHouse DDL 与 SmithDB record layout 位于闭源镜像，不能从 template 推断。
- UI 文档证明可观察行为；没有公开实现时，本研究不把按钮名称反推为新的 durable resource 或 server-side transaction。
