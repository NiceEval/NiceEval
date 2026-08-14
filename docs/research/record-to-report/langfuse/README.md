# Langfuse：Observation、Score、Experiment 与 Dashboard

> 观察日期：2026-08-14
>
> 观察对象：Langfuse Cloud 与自托管 OSS v4；官方 Python SDK v4.14.4
>
> 核对源码：[`langfuse/langfuse`](https://github.com/langfuse/langfuse) `7cc6d2c0b925c282021fdea11176066927ca4ab3`（2026-08-14）；[`langfuse/langfuse-python`](https://github.com/langfuse/langfuse-python) `73b5c028d2757d8960b3a468bd80c9ef99b52e74`（2026-08-11）；[`langfuse/langfuse-docs`](https://github.com/langfuse/langfuse-docs) `d0a5f34ef4aa92928ba08e067452d1be83a87cd6`（2026-08-13）
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 产品身份

Langfuse 是开源 LLM engineering 平台。
用户代码在自己的进程里跑业务或实验任务。
SDK 或 OpenTelemetry 把步骤写成 Observation。
同一套 Web 与 Worker 再查询、打分、比较并画 Dashboard。

官方 README 把它写成 collaboratively develop, monitor, evaluate, and debug AI applications。
见 [langfuse/langfuse README](https://github.com/langfuse/langfuse/blob/7cc6d2c0b925c282021fdea11176066927ca4ab3/README.md)。

本目录按 Langfuse 自己的名词写作，不套 Record → Analysis → Report。

## 用户心智

v4 的公开句子是：Langfuse stores one observations table。
每个行同时带 observation 级字段和一份 Trace 级属性副本。
`trace` 是共享同一 `trace_id` 的全部行。
`session` 是可选的多 Trace 分组。

见 [Observations & Traces](https://langfuse.com/docs/observability/data-model#observations-and-traces) 与 [Langfuse v4](https://langfuse.com/docs/v4#what-changed)。

评价不改 Observation。
Score 后补到 Trace、Observation、Session 或 DatasetRun 恰好之一。
见 [Scores Data Model](https://langfuse.com/docs/evaluation/scores/data-model)。

公开文档把 Experiment 与 Dataset 并列。
Dataset 管题；Experiment / DatasetRun 管某一次执行快照。
见 [Experiments as a First-Class Concept](https://langfuse.com/changelog/2026-04-13-experiments-rebuild)。
持久身份在 Postgres 仍叫 `dataset_runs`。

写入时不声明图表。
图表是读取侧的 Widget 与 Metrics 查询。

普通应用作者只看见 instrumentation 与可选 `score`。
分析与报告作者共用同一套 Metrics 查询，再在 UI 里摆 Widget。

## 原生对象总图

```text
Organization
  └── Project
        ├── Observation  （步骤行；v4 权威宽表）
        │     └── 共享 trace_id 的行集合 = Trace
        │           └── 可选 session_id = Session
        ├── Score  （后补评价；恰好挂 Trace、Observation、Session 或 DatasetRun 之一）
        ├── Dataset
        │     └── DatasetItem  （validFrom / validTo 版本）
        │           └── DatasetRun / Experiment
        │                 └── DatasetRunItem → Trace（可选 Observation）
        ├── ScoreConfig / EvalTemplate / JobConfiguration
        ├── Media  （对象存储字节 + token 引用）
        └── Dashboard / DashboardWidget  （查询声明，不是查询结果）
```

相邻产品面 Prompt Management 与 Playground 存在于官方 README，本方向不展开。

## 导航

| 页 | 只回答什么 |
|---|---|
| [layers.md](layers.md) | 产品自己的 layer、component、resource、owner、引用与依赖 |
| [execution.md](execution.md) | 一次请求或一次实验怎样发起、调度、执行、写入、完成、失败与 resume |
| [storage.md](storage.md) | 公开 type、表、文件、信封与 API resource；权威 / 派生 / 投影 |
| [reading-and-comparison.md](reading-and-comparison.md) | 历史怎样重开、query、filter、align、group、compare、render |
| [schema-and-migration.md](schema-and-migration.md) | 版本轨道、兼容读取、migration、是否改写已保存数据 |

## 对 NiceEval 的摘要

这张对照只存在于本页。
其它研究页继续使用 Observation、Score、DatasetRun、Dashboard 等原生词。

| 问题 | Langfuse | NiceEval | 不能直接类比 |
|---|---|---|---|
| 一次执行 | 共享 `trace_id` 的 Observation 树 | Attempt / Run | Trace 不是已发布不可变 Run |
| 实验身份 | Postgres `dataset_runs` + ClickHouse `experiment_id` | Experiment / Run | 服务端没有 Experiment 完成态枚举 |
| 官方 Timing | span 起止时间；读取时给 `latency` | OTel Timing Attachment | 没有独立 Timing schema family |
| 自定义用量 | `usage_details` 任意键 | 领域 Plugin + adapter | 没有版本化自定义事实 |
| 评价 | Score，可后补、可按三元组替换 | AssertionResult / Claim | 没有 evaluator 版本与 evidence basis |
| 证据 | `comment`、`TEXT` score、media token | Evidence / Attachment | 没有独立 Evidence 类型 |
| 分析 | Metrics view / dimension / measure | Analysis Dimension / Measure | 没有 Sample 分母与每 row 穷尽状态 |
| 报告 | Widget + Dashboard JSON | `ReportData` + 语义组件 | 报告作者仍写查询，不是只 import fields |
| 升级 | 平台 backfill 与 API 退役 | 显式 plan、authorization、receipt | 用户不签发相邻 migration |

值得吸收：写入不绑图表，评价与执行树分开，媒体按项目内 SHA256 去重。
同一产品同时提供行级与聚合读取，`isRootObservation` 区分物理父节点与逻辑根。
缺席字段保持缺席，短进程显式 `flush()`，升级可以分步双写。

不应复制：任意 metadata / usage 键充当 schema，或按三元组替换 Score 却不保存 evaluator 版本。
也不应把 database schemas 排除在公开 semver 之外同时回填用户观测数据。
封闭 observation 类型、报告作者直接写 Metrics JSON、用 `TEXT` score 充当 evidence，以及重发同一 `id` 做更正，也不适合 NiceEval。

NiceEval 建议：普通作者只碰领域 API；自定义事实必须有 owner 与显式 migration；分析要固定分母并保留每 row 状态；报告作者只组合已发布 fields。
平台可以 internally 回填查询投影，但不能把用户事实的改写排除在公开版本契约之外。
