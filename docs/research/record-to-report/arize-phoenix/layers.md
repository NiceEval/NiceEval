# Phoenix 的 layer、component 与 resource

> 观察日期：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页只写 Phoenix 自己的层、组件、资源，以及谁拥有它们、它们怎样互相引用。
发起与收尾顺序见 [execution.md](execution.md)。
表和信封见 [storage.md](storage.md)。
入口见 [README.md](README.md)。

这些名字来自官方文档与源码，不是研究方重命名。

## 部署与进程层

| 层 | 用户看见的名字 | 公开入口 | owner | 源码落点 |
|---|---|---|---|---|
| 采集 | OpenTelemetry + OpenInference | `phoenix.otel.register`，OTLP HTTP | 用户进程 | `packages/phoenix-otel`；服务端收 `v1/traces` |
| 服务 | Phoenix Server | `phoenix serve`，默认 UI/OTLP 端口 `6006` | 服务端进程 | `src/phoenix/server/` |
| 存储 | SQLite 或 PostgreSQL | 默认 `~/.phoenix/phoenix.db` | 服务端 | `get_env_database_connection_str` in `src/phoenix/config.py` |
| 客户端 | `arize-phoenix-client` | `Client().datasets` / `experiments` / `spans` | 用户进程 | `packages/phoenix-client/` |
| 独立评分库 | `phoenix-evals` | 可脱离服务端算出 Score | 用户进程 | `packages/phoenix-evals/` |
| 查询编译 | Filter Expression、`SpanQuery` | UI 过滤条、GraphQL、`POST /v1/spans` | 服务端 | `src/phoenix/trace/dsl/` |
| 后台作业 | Experiment Job | Playground Run / Stop / Resume | 服务端 `ExperimentRunner` | `experiment_jobs`；`experiment_runner.py` |
| 展示 | Projects、Traces、Sessions、Datasets、Compare、Metrics | 浏览器 UI | 服务端静态 UI | `app/src/pages/` |

产品事实：`phoenix-evals` 可以单独算出分数。
要进入同一产品的查询与 UI，必须再写成 Annotation 或 Experiment evaluation。
[Using Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/using-evaluators)

产品事实：自定义 alerting 与面向非开发者的 Dashboard，官方指向 Arize AX。
[Metrics Dashboard](https://arize.com/docs/phoenix/tracing/llm-traces/metrics)
Arize AX 的存储格式本次检查的一手公开面未提供。

## 用户资源

Phoenix 用户操作的是这些 resource，不是「Record 层」。

| Resource | 用户把它当成什么 | 依赖 |
|---|---|---|
| Project | Trace 的容器；名字唯一 | 可选 retention policy |
| ProjectSession | 一次会话里的多条 Trace | `session.id` 属性；属于一个 Project |
| Trace / Span | 一次应用运行及其步骤 | 属于 Project；Span 组成 Trace |
| Dataset / DatasetVersion / Example | 评测题集及其版本化行 | Example 可选指向源 Span |
| DatasetSplit / DatasetLabel | 题集子集与标签 | 挂在 Dataset / Example 上 |
| Experiment | 钉在某个 Dataset 版本上的一次评测 | 创建时快照 example revision |
| ExperimentRun | 某个 example 的一次 repetition | 可选 `trace_id` 指向 Task Trace |
| Annotation | 写回的 label / score / explanation | 钉在 Span、Trace、Document、Session 或 ExperimentRun 上 |
| Evaluator / Dataset Evaluator | 可复用的评分器 | Dataset Evaluator 必填专用 Project |
| Prompt / PromptVersion | Playground 与 LLM evaluator 的模板 | 可被 tag 固定到某一 version |
| ExperimentJob | 仅 Playground / `EVAL_ONLY` 的服务端作业 | 外键就是 Experiment 主键 |

产品事实：Task 是用户函数，不是服务端 resource。它没有独立 ID。
[Run Experiments](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments)

## Owner

| 事实 | owner | 不拥有它的一方 |
|---|---|---|
| 业务代码与 SDK Task | 用户进程 | Phoenix Server 不调度这段函数 |
| Playground Prompt Task | `ExperimentRunner` | 浏览器只发 Run / Stop / Resume |
| Dataset Evaluator 执行 | `ExperimentRunner` | SDK `run_experiment` 必须自己传入 evaluators |
| Trace / Span 入库 | 用户进程的 OTLP exporter，加上服务端 `BulkInserter` | Client 实验库不直接 INSERT spans 表 |
| Dataset / Experiment 行 | 创建它们的 REST handler | runner 只认领已存在的 Experiment |
| ExperimentRun / Experiment Evaluation | Client 或 `ExperimentRunner` | 服务端不替 SDK 发明 Task 输出 |
| SpanCost | `SpanCostCalculator` daemon | 用户不手写 USD |
| 预置 Metrics | 服务端按已有行聚合 | 作者不声明 Dashboard |

## 引用与依赖

```text
用户应用 ──OTLP──► Phoenix Server ──SQL──► phoenix.db
     │                                      ▲
     └── REST Client ──/v1/*────────────────┘

phoenix-evals ──可选──► Annotation / Experiment evaluation
Playground ──► Experiment + ExperimentJob ──► ExperimentRunner
DatasetEvaluator.project_id ──RESTRICT──► Project
Experiment.dataset_version_id ──► DatasetVersion
ExperimentRun.trace_id ──字符串，非 FK──► Trace
ExperimentRunAnnotation.trace_id ──字符串──► evaluator Trace
```

产品事实：`ExperimentRun.trace_id` 与 `ExperimentRunAnnotation.trace_id` 都是字符串。
它们不是指向 `traces.trace_id` 的数据库外键。
ORM 用 `foreign() == Trace.trace_id` 做软关联。
[`models.py` @ 20.2.0](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/models.py)

产品事实：Dataset Evaluator 自动跑只发生在 UI / Playground 实验。
SDK 路径不读这张挂接表来替用户跑函数。
[Dataset Evaluators](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/how-to-dataset-evaluators)

相邻产品面 Prompt Hub、PXI、MCP 官方另有入口。
它们不构成本页的 resource 真源。
Evaluator 自己的 Trace 面见 [evaluator-observability.md](evaluator-observability.md)。
