# MLflow：Experiment、Run、Trace 与 Tracking UI

> 观察日期：2026-08-14
>
> 观察对象：开源 MLflow Tracking 与 GenAI Tracing，tag `v3.15.1`，commit `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

MLflow 是开源 ML 与 GenAI 的 experiment tracking 平台。
用户代码在自己的进程里训练、推理或评估。
SDK 把 Param、Metric、Artifact、Trace 与 Assessment 写进同一 Tracking 面。
随后同一产品用 Tracking UI、`search_runs` 和 `search_traces` 读回来。

官方把它写成：在运行机器学习代码时写入参数、代码版本、指标和输出文件，并在之后可视化结果。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)。

本目录按 MLflow 自己的对象组织，不套 Record → Analysis → Report。

## 研究页导航

| 页 | 回答什么 |
| --- | --- |
| 本页 | 产品是什么、用户心智、原生对象总图，以及最后才写的 NiceEval 对照 |
| [Layers](layers.md) | SDK、Server、Backend Store、Artifact Store、UI 与对象之间的 owner、引用和依赖 |
| [Execution](execution.md) | Run 与 Trace 从发起、写入、完成到失败、partial、resume 的真实顺序 |
| [Storage](storage.md) | 公开 entity、SQL 表、FileStore 目录、信封，以及权威事实 / 派生值 / cache |
| [Reading and comparison](reading-and-comparison.md) | 历史怎样重开、query、filter、align、group、compare 和展示 |
| [Schema and migration](schema-and-migration.md) | Alembic、兼容 reader、升级命令，以及会不会改写已保存数据 |
| [Tracing 与 Assessment](tracing-and-assessments.md) | MLflow 自己拆出的 GenAI 产品面：Trace、Span、Assessment、Evaluation Dataset |

机制细节只写在对应页。
本页不重复事务、表结构和查询语法。

## 观察边界

| 对象 | 观察版本 | 固定方式 |
| --- | --- | --- |
| 正式 tag | `v3.15.1` | [GitHub Release](https://github.com/mlflow/mlflow/releases/tag/v3.15.1)，commit `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`，2026-08-03 |
| 滚动文档 | `/docs/latest/` | 2026-08-14 打开的官方页；路径会随发布滚动 |
| 源码核对 | 同 tag | 本地浅克隆 `/tmp/mlflow-src`，与上述 commit 一致 |

滚动文档与源码冲突时，以 tag 源码为准。
Databricks 托管 Tracking 只公开 REST 客户端。
本次检查的一手公开面未提供其内部表或对象布局，后文只写“未公开”。

## 用户心智模型

用户的核心心智是：往当前 Experiment 的一次 Run 记名字和值，再用同一 UI 搜回来。

Experiment 是容器。
Run 是一次执行，例如一次 `python train.py`。
一次 Run 同时有元数据和大文件：Param / Metric / Tag 是元数据，模型权重和图像是 Artifact。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)。

MLflow 3 另把 Logged Model 提升为独立对象。
同一 Run 可以记下多个 checkpoint，每个有自己的 `model_id`。
见 [Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)。

GenAI 面再加一条平行对象：Trace 是 span tree，Assessment 是挂在 Trace 或 Span 上的评价。
它们与 Run 共用 Tracking Server 和 UI，但不是 Run 的字段。
见 [Tracing 与 Assessment](tracing-and-assessments.md)。

普通作者只看见 fluent API、autolog 和 Tracking UI。
他们不把 Backend Store 表或 `./mlruns` 目录当成阅读界面。

## 原生对象总图

```text
Experiment
  ├── Run
  │     ├── Param / Metric / Tag
  │     ├── DatasetInput
  │     ├── Logged Model（可选，MLflow 3）
  │     └── Artifact（字节在 Artifact Store）
  └── Trace
        ├── Span
        └── Assessment（Feedback / Expectation / Issue）

Evaluation Dataset ── 可从 Trace 收录测试行；完整能力需要 SQL Backend Store
```

| 对象 | 用户把它当成什么 | 身份 |
| --- | --- | --- |
| Experiment | 一组 Run 与 Trace 的容器 | `experiment_id` 字符串 |
| Run | 一次代码执行 | 32 位 hex `run_id` |
| Param / Metric / Tag | 这次执行上的名字和值 | `(run_id, key)`，Metric 另加 step / timestamp |
| Artifact | 这次执行产出的文件 | `artifact_uri` + 相对路径 |
| Logged Model | 一次 checkpoint | `model_id` |
| Trace / Span | 一次应用请求的步骤树 | `trace_id` / `span_id` |
| Assessment | 对 Trace 或 Span 的判断 | `assessment_id` |
| Evaluation Dataset | 持续增长的评测题集 | `dataset_id` |

部署上，这些对象穿过四块具名部件：SDK、可选 Tracking Server、Backend Store、Artifact Store。
部件边界、owner 和依赖见 [Layers](layers.md)。

默认 Tracking URI 是 `sqlite:///mlflow.db`。
当前目录已有带 `meta.yaml` 的 `./mlruns` 时，继续用 FileStore。
FileStore 处于维护模式。细节见 [Layers](layers.md) 与 [Schema and migration](schema-and-migration.md)。

## 与 NiceEval 的相似点与差异

这是研究对照，不是 MLflow 自己的产品分层。

| MLflow 对象 | 最接近的 NiceEval 词 | 不能直接类比的地方 |
| --- | --- | --- |
| Experiment | 一组 Run 的容器 | 没有 eligibility identity，也没有固定题集分母 |
| Run | 一次执行的稳定身份 | 可 resume、可软删，不是 sealed Attempt |
| Param / Metric / Tag | 中立的名字与值 | 没有 owner-local RecordAttachment family |
| Artifact / `log_table` | 大对象与表格材料 | 路径即身份，没有 content-addressed closure |
| Trace / Assessment | 执行观测与评价 | 评价可 update / delete |
| `search_runs` DataFrame | 分析读面 | 缺列填 `NaN` / `None`，没有穷尽 coverage |
| Tracking UI | 报告呈现 | 没有独立 Report 作者层 |

相似点：同一产品同时拥有写入、持久 store、查询 DSL 和官方 UI。
主写入 API 保持中立，`log_metric` 不要求先选图表。
查询词与 UI 过滤共用 `metrics.` / `params.` / `tags.` 前缀。

差异：稳定身份是服务器分配的 UUID，不是封口 revision。
缺值用 `NaN` / `None` 表示。
产品用 Alembic 升级自己的 store，用户自定义事实没有 version family。
FileStore 与 SQL 不是同一功能面。

可吸收约束见各机制页末的研究判断，不在本页复述表结构或查询语法。
