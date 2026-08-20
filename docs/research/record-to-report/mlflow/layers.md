# MLflow Layers：部件、对象、owner 与依赖

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页只写 MLflow 自己的 layer、component 与 resource。
发起与收尾顺序见 [Execution](execution.md)。
表和目录见 [Storage](storage.md)。

## 部署部件

官方架构把 Tracking 拆成四块。
见 [Architecture Overview](https://mlflow.org/docs/latest/self-hosting/architecture/overview/)。

```text
SDK  ──可选──►  Tracking Server  ──►  Backend Store
                                 └──►  Artifact Store
Tracking UI 挂在 Tracking Server 上；本地也可让 SDK 直连 store
```

| 部件 | 公开职责 | Owner | 用户是否必须看见 |
| --- | --- | --- | --- |
| SDK | fluent、`MlflowClient`、autolog、REST 客户端 | 用户进程 | 是 |
| Tracking Server | FastAPI REST、UI 托管、可选 artifact 代理 | 运维进程 | 单人本地可以没有 |
| Backend Store | Experiment / Run / Trace 元数据 | SQLAlchemy 或 FileStore | 运维选 URI |
| Artifact Store | 模型权重、图像、`log_table`、`traces.json` | 本地盘或对象存储 | 运维选根路径 |
| Tracking UI | Experiment 列表、Run 比较、Traces 页 | Server 提供的静态面 | 是，默认阅读入口 |
| Model Registry | 已注册模型名与 version | 必须挂在数据库 Backend Store | 只用模型注册时才看见 |

产品事实：各语言 SDK 的能力并不相同。
Python 最完整。Java / R 只有基础日志与有限搜索。REST 提供基础日志和搜索，不提供 autolog。
见 [Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)。

产品事实：Workspace 是可选的组织层。
它把 Experiment、Registered Model、Prompt 和 Artifact 按团队切开。
它要求 SQL Backend Store，默认关闭。
见 [Architecture Overview](https://mlflow.org/docs/latest/self-hosting/architecture/overview/)。

## 默认 Backend 与两套实现

产品事实：未配置时，`_get_default_tracking_uri()` 返回 `sqlite:///mlflow.db`。
当前目录已有带 `meta.yaml` 的数字 Experiment 目录时，改回 `./mlruns`。
符号在 [`mlflow/tracking/_tracking_service/utils.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/_tracking_service/utils.py) 与 [`mlflow/store/tracking/__init__.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/__init__.py)。

产品事实：FileStore 处于维护模式。
未设进程变量 `MLFLOW_ALLOW_FILE_STORE=true` 时，实例化会报错并指向 `mlflow migrate-filestore`。
见 [Backend Stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/) 与 [`FileStore.__init__`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py)。

两套 Backend 实现同一批公开 entity，但不是同一功能面。
Evaluation Dataset、`log_spans`、`query_trace_metrics` 和 Trace-to-Run 关联只在 SQL。
见 [Tracing 与 Assessment](tracing-and-assessments.md) 与 [Storage](storage.md)。

Databricks workspace URI（`databricks` 或 `databricks://<profile>`）走托管 REST。
本次检查的一手公开面未提供其内部表。

## 领域对象与引用

| 对象 | 公开类型 | 属于谁 | 引用什么 |
| --- | --- | --- | --- |
| Experiment | `mlflow.entities.Experiment` | Workspace（默认 `default`） | `artifact_location` 指向 Artifact Store 根 |
| Experiment tag | `ExperimentTag` | Experiment | 无 |
| Run | `Run` = `RunInfo` + `RunData` + 可选 inputs/outputs | Experiment | `artifact_uri` 指向该 Run 的 artifact 根 |
| Param | `Param` | Run | `(run_id, key)` 唯一 |
| Metric | `Metric` | Run；可选再绑 `model_id` 与 dataset | 历史行按 step / timestamp 追加 |
| Run tag | `RunTag` | Run | 嵌套关系写在 `mlflow.parentRunId` |
| Dataset input | `Dataset` / `DatasetInput` | Experiment + Run | `(experiment_id, name, digest)` |
| Logged Model | `LoggedModel` | Experiment；常由某次 Run 产出 | `models:/<model_id>` |
| Artifact | 路径上的字节 | Run 或 Trace | 没有内容哈希 |
| Trace | `TraceInfo` + `TraceData` | Experiment | 可用 `entity_associations` 链到 Run |
| Span | `Span` | Trace | `parent_span_id` |
| Assessment | `Feedback` / `Expectation` | Trace；可选 `span_id` / `run_id` | `overrides` 指向另一条 Assessment |
| Evaluation Dataset | `EvaluationDataset` | Workspace；可关联多个 Experiment | 测试行可用 `input_hash` 去重 |

产品事实：用户读写的是 entity 和 REST resource，不是表。
`Run.to_dictionary()` 与 `mlflow runs describe` 共用同一份 JSON 信封。
见 [`mlflow/entities/run.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/run.py) 与 [`mlflow/runs.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/runs.py)。

## Owner

| 动作面 | Owner | 不负责 |
| --- | --- | --- |
| 创建 Experiment / Run / Trace | 用户进程里的 SDK，或 Tracking Server 代写 | 中心调度器 |
| `log_param` / `log_metric` / `set_tag` / `log_artifact` | 同一 SDK 或 Server | Artifact Store 的 schema |
| Assessment 后补、update、delete | SDK、`mlflow traces *`、UI | 不可变 Claim |
| 软删除 / restore | SDK、CLI、UI | 字节回收 |
| 硬删除 | `mlflow gc` | 普通 `show` 路径 |
| schema 升级 | 运维跑 `mlflow db upgrade` | 用户 payload converter |

产品事实：Tracking Server 默认既服务元数据也代理 artifact。
`--no-serve-artifacts` 时客户端直连对象存储。
`--artifacts-only` 时该进程只做 artifact 代理。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) 与 [Artifact Stores](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/)。

## 依赖

1. Model Registry 依赖数据库 Backend Store。FileStore 不能承担注册面。
2. Evaluation Dataset 依赖 SQL Backend Store。
3. OTLP `/v1/traces` 依赖带 SQL 的 Tracking Server。
4. Tracking UI 依赖能读同一 Backend Store 的 Server；本地 `mlflow server` 即可。
5. Artifact 字节不进 Backend Store。删 Run 不会自动回收对象存储。
6. FileStore 可以保存 TraceInfo 与 Assessment YAML，但不能 `log_spans` 进表。

研究判断：MLflow 的分层是“客户端 / 可选服务器 / 元数据店 / 大文件店”，加上一套领域对象图。
它不是 Record / Analysis / Report，也不是 adapter / projector / renderer。
