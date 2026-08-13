# MLflow：用户代码运行、SDK 写入、同一产品读取与展示

> 观察日期：2026-08-13
>
> 观察对象：MLflow Tracking、GenAI Evaluation、Tracing 与 Tracking Store
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

MLflow 是一套完整平台。用户代码真实执行，Python / REST SDK 把参数、指标、artifact、trace 与评估写进同一 Tracking Server。随后同一产品用 `search_runs`、Tracking UI 与评估页读取、比较并展示。它不是外接 SQL 后再画图的 BI 工具。

本文只采用官方文档、官方 API 参考、官方 GitHub 仓库与正式 migration 文档。滚动文档 `/docs/latest/` 在观察日指向 Python API `3.15.1`。无法把该路径固定到未来某一提交时，一律写明观察边界。

## 观察边界与一手材料

### 固定快照

| 对象 | 观察版本 | 固定方式 | 观察事实 |
| --- | --- | --- | --- |
| 滚动文档 | `/docs/latest/` | 2026-08-13 打开时 Python API 页标题为 `3.15.1` | 该路径会随发布滚动，不能当作永久 pin。[PY-API] |
| Python / 仓库 tag | `v3.15.1` | GitHub Release，commit `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870` | 2026-08-03 发布的最新正式 tag。[REL] |
| Tracking Store 模型 | 同 tag | `mlflow/store/tracking/dbmodels/models.py` | Experiment、Run、Param、Metric、Tag、Trace、Assessment 的表形状。[DB] |
| Alembic 迁移 | 同 tag | `mlflow/store/db_migrations/versions/` | schema 变更以 Alembic revision 追加，不要求 major bump。[MIG-DIR] [UPGRADE] |

滚动文档与 tag 在观察日一致。后文代码片段以 `v3.15.1` 源码和当日 `/docs/latest/` 为准。若两者冲突，以 tag 源码为准，并标明文档页。

### 一手材料索引

| 代号 | 可定位内容 |
| --- | --- |
| [TRACK] | [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)：Run、Experiment、Backend Store、Artifact Store、Tracking UI |
| [API] | [Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)：fluent 写入、嵌套 Run、system tags |
| [PY-API] | [mlflow 3.15.1](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.html)：`start_run`、`log_*`、`search_runs` |
| [CLIENT] | [MlflowClient](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.client.html)：低层 CRUD |
| [SEARCH] | [Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/)：过滤语法、missing、UI 与 Python |
| [EVAL-ML] | [Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/)：`mlflow.models.evaluate` |
| [EVAL-GEN] | [LLM and Agent Evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/)：`mlflow.genai.evaluate` |
| [FB] | [Feedback Collection](https://mlflow.org/docs/latest/genai/assessments/feedback/) 与 [Feedback Concepts](https://mlflow.org/docs/latest/genai/concepts/feedback/) |
| [OTEL-IN] | [Collect OpenTelemetry Traces](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/ingest/) |
| [OTEL-OUT] | [Export via OTLP](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/) |
| [OTEL-MAP] | [Attribute Mapping](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/attribute-mapping/) |
| [SYS] | [System Metrics](https://mlflow.org/docs/latest/ml/tracking/system-metrics/) |
| [STORE] | [Backend Stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/) |
| [ART] | [Artifact Stores](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/) |
| [UPGRADE] | [How to Upgrade MLflow](https://mlflow.org/docs/latest/self-hosting/migration/) |
| [FILEMIG] | [Migrate from File Store](https://mlflow.org/docs/latest/self-hosting/migrate-from-file-store/) |
| [TUNE] | [Hyperparameter Tuning](https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/) |
| [SCORER-V] | [Registering and Versioning Scorers](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/versioning/) |
| [REL] | [v3.15.1 Release](https://github.com/mlflow/mlflow/releases/tag/v3.15.1) |
| [FLUENT] | [`mlflow/tracking/fluent.py` @ v3.15.1](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/fluent.py) |
| [ASSESS] | [`mlflow/tracing/assessment.py` @ v3.15.1](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracing/assessment.py) |
| [DB] | [`mlflow/store/tracking/dbmodels/models.py` @ v3.15.1](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/dbmodels/models.py) |
| [MIG-DIR] | [Alembic versions @ v3.15.1](https://github.com/mlflow/mlflow/tree/v3.15.1/mlflow/store/db_migrations/versions) |

产品没有在上述公开面写出某能力时，本文只写“本次检查的一手公开面未提供”，不推断内部实现。

## 产品定位与真实边界

产品事实：Tracking 把自己定义为“在运行机器学习代码时写入参数、代码版本、指标和输出文件，并在之后可视化结果”的 API 与 UI。[TRACK]

产品事实：默认情况下，不配置服务器时数据写到本地 `mlruns`。要共享结果，再接到远程数据库和对象存储。[TRACK]

产品事实：公开部署面由三部分组成。SDK 在用户进程里调用；Backend Store 保存 Run 元数据；Artifact Store 保存大文件。[TRACK] [STORE] [ART]

```text
用户训练 / 推理 / 评估代码
        │  fluent 或 MlflowClient
        ▼
Tracking Server  ──► Backend Store（SQLite / PostgreSQL / MySQL / MSSQL）
                └──► Artifact Store（本地、S3、GCS、Azure Blob 等）
        │
        ▼
同一 Tracking UI、search_runs、load_table、评估页
```

产品事实：经典 ML 评估与 GenAI 评估不是同一套系统。`EvaluationMetric` 不能用于 `mlflow.genai.evaluate()`，`Scorer` 不能用于 `mlflow.models.evaluate()`。[EVAL-ML]

研究判断：MLflow 对 NiceEval 有价值，是因为它同时拥有写入契约、持久 schema、查询 DSL 和官方 UI。它不是“先落盘再另开 BI”的外挂分析器。

## 与 NiceEval 概念的对应

| MLflow 公开对象 | 最接近的 NiceEval 词 | 不能直接类比的地方 |
| --- | --- | --- |
| Experiment | 一组 Run 的容器，不是 `defineExperiment` | 没有 eligibility identity，也没有固定题集分母 |
| Run | 一次执行的稳定身份 | 可 resume、可 delete/restore，不是 sealed Attempt |
| Param / Metric / Tag | 中立的名字与值 | 没有 owner-local RecordAttachment family |
| Artifact / `log_table` | 大对象与表格材料 | 路径即身份，没有 content-addressed closure |
| Trace / Span | 执行观测 | 翻译已知 OTel 字段，不承诺 unknown payload 原字节往返 |
| Feedback / Expectation | 评价与期望 | 可 update、delete、override，不是不可变 Claim |
| `search_runs` DataFrame | 分析读面 | 缺列填 `NaN`/`None`，没有穷尽 coverage 或 issues |
| Tracking UI / 评估页 | 报告呈现 | UI 从已有 metric/param 推断图表，没有独立 Report 作者层 |

## 1. Run 与 Experiment 怎样开始、封口并形成稳定身份

产品事实：组织单位是 Experiment。Experiment 下有多次 Run。Run 是“某段数据科学代码的一次执行”，例如一次 `python train.py`。[TRACK]

产品事实：身份在创建时由 Tracking Store 分配。数据库里 Run 主键是 32 字符 `run_uuid`。Experiment 主键是自增整数 `experiment_id`，对外以字符串返回。[DB] [CLIENT]

```python
import mlflow

mlflow.start_run()
mlflow.log_param("my", "param")
mlflow.log_metric("score", 100)
mlflow.end_run()
```

这是 `3.15.1` fluent 模块开头的官方最小例子。`with mlflow.start_run() as run:` 会在离开块时自动结束。[PY-API]

产品事实：`start_run` 接受 `run_id` 时尝试恢复已有 Run，并把状态设为 `RUNNING`。其它参数被忽略。`run_id` 优先于进程变量 `MLFLOW_RUN_ID`。[FLUENT]

```python
def start_run(
    run_id: str | None = None,
    experiment_id: str | None = None,
    run_name: str | None = None,
    nested: bool = False,
    parent_run_id: str | None = None,
    tags: dict[str, Any] | None = None,
    description: str | None = None,
    log_system_metrics: bool | None = None,
) -> ActiveRun:
```

产品事实：同一线程已有活动 Run 时，必须先 `end_run()`，或传 `nested=True`。子 Run 通过 tag `mlflow.parentRunId` 挂到父 Run。[FLUENT] [API]

产品事实：数据库允许的 Run 状态是 `SCHEDULED`、`RUNNING`、`FINISHED`、`FAILED`、`KILLED`。生命周期阶段是 `active` 或 `deleted`。删除写入 `deleted_time`，默认不立刻清元数据和 artifact。[DB] [STORE]

产品事实：创建 Run 时自动写一组 system tags：`mlflow.source.name`、`mlflow.source.type`、`mlflow.user`。来自 git 仓库时再写 `mlflow.source.git.commit`。用户说明写在可编辑的 `mlflow.note.content`。[API]

产品事实：fluent API 不是线程安全的。跨线程调用必须自行互斥。[PY-API]

产品事实：没有活动 Run 时，`log_param` / `log_metric` 会自动开一个新 Run。[FLUENT]

研究判断：MLflow 的稳定身份是“服务器分配的 UUID + Experiment 归属”，不是内容哈希。Resume 说明同一 `run_id` 可以继续追加，不是封口后的不可变 revision。

## 2. 官方事实怎样写入

产品事实：官方把一次 Run 上的事实分成几类固定 envelope。作者扩展的是 key 和 value，不是新表或新 schema 版本。[API] [DB]

### Param

```python
with mlflow.start_run():
    mlflow.log_param("learning_rate", 0.01)
    mlflow.log_param("batch_size", 32)
```

产品事实：key 只允许字母数字、`_`、`-`、`.`、空格和 `/`。内置 store 的 key 最长 250。value 会被转成字符串。文档写内置 store 支持到 6000；SQL 模型列宽是 8000。`(key, run_uuid)` 是主键，同一 Run 同一 key 只有一行。[API] [FLUENT] [DB] [STORE]

### Metric

```python
mlflow.log_metric("accuracy", 0.95, step=10)
mlflow.log_metrics({"train_loss": train_loss, "val_loss": val_loss}, step=epoch)
```

产品事实：value 是 float。step 是 64 位整数，可为负、可乱序、可有缺口。timestamp 以毫秒计。MLflow 3 还可把 metric 绑到 `model_id` 和 dataset。[API] [FLUENT] [TRACK]

产品事实：`metrics` 表主键是 `(key, timestamp, step, run_uuid, value, is_nan)`。`latest_metrics` 另存每个 key 的最新值，供列表和搜索使用。[DB]

### Tag

```python
mlflow.set_tag("model_type", "CNN")
mlflow.set_tags({"task": "classification", "environment": "notebook"})
```

产品事实：tag 是可变字符串元数据。可以 `delete_tag`。SQL 列宽 key 250、value 8000。文档写 value 最长 5000。这是公开面自己的长度差，不是本文推断。[API] [FLUENT] [DB]

### Dataset 输入

```python
dataset = mlflow.data.from_numpy(
    features=np.random.uniform(size=[20, 28, 28, 3]),
    targets=np.random.randint(0, 10, size=[20]),
    name=dataset_name[i],
    digest=dataset_digest[i],
)
mlflow.log_input(dataset, context=dataset_context[i])
```

这是官方 Search 指南用来造 10 次 Run 的片段。[SEARCH]

### Artifact、figure、dict、table

```python
mlflow.log_artifact("model.pkl")
mlflow.log_artifacts("./plots/")
mlflow.log_dict(dictionary, "dir/data.yml")
mlflow.log_figure(fig, "figure.html")
mlflow.log_table(data=table_dict, artifact_file="qabot_eval_results.json")
```

产品事实：`log_table` 把 dict 或 DataFrame 写成 JSON artifact。同路径已存在时追加。`load_table` 可从多次 Run 拼回 DataFrame，并用 `extra_columns=["run_id"]` 补 Run 身份。[FLUENT] [PY-API]

产品事实：artifact 元数据在 Backend Store，字节在 Artifact Store。默认本地 `./mlruns`，也可接到 S3、GCS、Azure Blob。[ART]

### 系统指标

```python
with mlflow.start_run(log_system_metrics=True) as run:
    time.sleep(15)
```

产品事实：开启后按采样间隔写 `system/cpu_utilization_percentage`、`system/gpu_utilization_percentage`、`system/gpu_power_usage_watts` 等。GPU 项需要可用 GPU 和 `nvidia-ml-py`。这是官方 metric，不是用户自定义 schema。[SYS]

### 经典评估与 GenAI 评估

```python
with mlflow.start_run():
    result = mlflow.models.evaluate(
        model_info.model_uri,
        eval_data,
        targets="label",
        model_type="classifier",
    )
    print(f"Accuracy: {result.metrics['accuracy_score']:.3f}")
```

产品事实：`evaluate` 自动生成 accuracy、F1、ROC-AUC，以及混淆矩阵、ROC 曲线等 artifact。可用 `make_metric` 与 `custom_artifacts` 再加自定义数字和图。[EVAL-ML]

```python
results = mlflow.genai.evaluate(
    data=dataset,
    predict_fn=predict_fn,
    scorers=[
        Correctness(),
        Guidelines(name="is_english", guidelines="The answer must be in English"),
    ],
)
```

产品事实：GenAI 评估由 Dataset、Scorer 和可选 `predict_fn` 组成。结果成为一次 evaluation Run，并在 Tracking UI 的 Runs 页打开。[EVAL-GEN]

### Assessment

```python
feedback = mlflow.log_feedback(
    trace_id="tr-1234567890abcdef",
    name="relevance",
    value=0.9,
    source=AssessmentSource(
        source_type=AssessmentSourceType.LLM_JUDGE, source_id="gpt-4"
    ),
    rationale="Response directly addresses the user's question",
)
```

产品事实：Feedback 的公开字段是 `name`、`value`、`rationale`、`source`、可选 `error` / `metadata` / `span_id`。`value` 可以是数字、布尔、分类标签或结构化 dict。失败可以只写 `AssessmentError`，不写分数。[FB] [ASSESS]

产品事实：`assessments` 表把 `value`、`error`、`assessment_metadata` 存成 JSON 文本。`assessment_type` 是 `feedback`、`expectation` 或 `issue`。`valid` 默认为 true。`overrides` 指向被替代的 `assessment_id`。[DB]

## 3. 用户扩展的是什么

研究判断先写在前面，依据是上一节的公开形状。

| 写入面 | 扩展单位 | 形状 |
| --- | --- | --- |
| Param / Metric / Tag | 名字和值 | 固定列：key + string 或 float + 可选 step |
| Artifact / `log_table` / `log_dict` | 路径上的任意文件或 JSON | 没有用户声明的 schema 版本 |
| Span attribute / tag | 任意属性 | OTel 或 MLflow tag；已知字段才被翻译 |
| Feedback / Expectation | 固定 envelope 里的名字和值 | `name` + `value: Any` + source / rationale / error |
| Scorer 注册 | 评估定义的版本 | 按 Experiment + name 递增 version，不是持久事实 schema |

产品事实：Param、Metric、Tag 都要求 key 字符集，并把 value 放进固定列。没有用户侧 `schemaId` 或相邻 migration。[FLUENT] [DB]

产品事实：Assessment 的 envelope 固定，payload 却是任意 JSON。公开 API 允许 `update_assessment` 原地改，也允许 `delete_assessment` 删除。`override_feedback` 另写一条，并把旧条标为 invalid。[FB] [ASSESS]

产品事实：Scorer 可以按 Experiment 注册。第一次注册是 version 1，同名再注册递增。Code-based scorer 与 Guidelines judge 不支持这条注册面。[SCORER-V]

产品事实：本次检查的一手公开面未提供“用户为自定义 GPU 能量声明版本化 family、相邻 converter 与 opaque installation”的 API。

研究判断：MLflow 的默认扩展是“在固定信封里换名字和值”。Assessment 是固定 envelope 加任意 JSON。Artifact 是任意字节。都不是 NiceEval 那种版本化 RecordAttachment family。

## 4. 写入时是否绑定展示

产品事实：`log_param`、`log_metric`、`set_tag`、`log_table` 只要求 key、value 和路径。它们不接收 chart type、坐标轴或页面声明。[API] [FLUENT]

产品事实：`log_figure` 和 `log_image` 直接保存可显示文件。这是展示用的生成文件，不是中立数字。[FLUENT]

产品事实：`mlflow.models.evaluate` 会按 `model_type` 自动生成混淆矩阵、ROC 曲线，并写入 artifact。作者选择评估任务类型，也就选择了默认图。[EVAL-ML]

产品事实：Tracking UI 从已写入的 metric / param 画图、列表和比较。超参教程写：点左上角 chart 图标即可看 tuning 结果。[TRACK] [TUNE]

产品事实：系统指标出现在 UI 的 metrics 区。文档没有要求作者再声明一张“系统指标图”。[SYS]

研究判断：主写入路径是中立事实。绑定展示的是三条旁路：作者主动 `log_figure`、经典 `evaluate` 的内置图、UI 按名字推断的 chart。MLflow 没有与写入 API 共用的 Report 声明对象。

NiceEval 建议：普通领域写入应保持中立。自动出图可以留在官方评估或 Report 层，不要让 `log_metric` 一类 API 带上 chart 参数。

## 5. 读取与分析怎样选 Run、分组、聚合并处理缺失

产品事实：官方查询入口是 SQL 风格的 `filter_string`，用于 UI 和 `mlflow.search_runs`。它受 SQL 启发，但不是完整 SQL。明确不支持 `OR`。[SEARCH]

```python
bad_runs = mlflow.search_runs(
    filter_string="metrics.loss > 0.8",
    search_all_experiments=True,
)
```

```python
client = mlflow.tracking.MlflowClient()
best_run = client.search_runs(
    experiment_id, order_by=["metrics.val_loss ASC"], max_results=1
)[0]
print(best_run.data.metrics)
# {'val_loss': 0.123}
```

第二段是 Tracking 首页的官方片段。[TRACK] [SEARCH]

产品事实：可过滤的前缀是 `metrics.`、`params.`、`tags.`、`datasets.name` / `digest` / `context`，以及 `attributes.run_id` 等 Run 元数据。数字 metric 用 `>` `>=` `<` `<=` `=` `!=`。字符串用 `=` `!=` `LIKE` `ILIKE`。tag / param 可用 `IS NULL` / `IS NOT NULL` 判断是否存在。[SEARCH]

产品事实：`IN` 只允许 `datasets.name`、`datasets.digest`、`datasets.context`、`attributes.run_id`。含特殊字符的字段要用反引号。param 即使看起来像数字，比较时也必须加引号，因为 store 里是字符串。[SEARCH]

产品事实：`search_runs(..., output_format="pandas")` 把每个 metric、param、tag 展开成列。某次 Run 没有该列时，metric 是 NumPy `NaN`，param / tag 是 `None`。默认最多 100,000 行，视图默认 `ACTIVE_ONLY`。[FLUENT]

产品事实：本次检查的一手公开面未提供 search DSL 里的 `GROUP BY`、分母声明或 `unsupported` 状态。聚合发生在取回 DataFrame 之后，或发生在 UI chart 里。

产品事实：MLflow 3 的 `search_logged_models` 可以按 metric / param 排序，并按 dataset 限制比较口径。[TRACK]

研究判断：MLflow 能选出 Run 并承认“这一格没有值”。它不把 missing、partial、unsupported 收成分析层的穷尽状态。分母和 coverage 要作者自己用 pandas 算。

NiceEval 建议：可以吸收“查询与 UI 共用同一套过滤词”。不要吸收“缺列就变 NaN，由读者心算分母”。

## 6. 图表、比较与报告怎样消费分析结果

产品事实：Tracking UI 提供 Experiment 级 Run 列表与比较，包括跨 Experiment 比较；按 param / metric 搜索；可视化 metric；下载 artifact 与元数据。[TRACK]

产品事实：同一 UI 也服务 Logged Model。本地 `mlruns` 用 `mlflow server --port 5000` 打开。[TRACK]

产品事实：超参场景用父 Run 包住多次 `nested=True` 子 Run。UI 的 chart 图标展示 tuning 结果，再点进子 Run 看每次试验。[TUNE]

```python
with mlflow.start_run(nested=True, run_name=f"trial_{trial.number}") as child_run:
    mlflow.log_params(params)
    mlflow.log_metrics({"error": error})
    mlflow.sklearn.log_model(regressor_obj, name="model")
```

产品事实：GenAI 评估完成后，作者打开同一 Tracking UI，在 Runs 页点进新的 evaluation Run 看结果。官方没有另给一套 Report 源码 API。[EVAL-GEN]

产品事实：`load_table` 把多次 Run 的同名 JSON 表拼成 DataFrame，供 notebook 或脚本再画图。这是读回写入的 table，不是独立报告声明。[FLUENT]

产品事实：本次检查的一手公开面未提供与 NiceEval `ReportData` / `aggregate()` / Page 对应的、代码与 UI 共用的报告声明。也没有独立的 Dashboard 作者 SDK。

研究判断：MLflow 的“报告作者”默认就是 Tracking UI 用户，或拿着 `search_runs` DataFrame 写 notebook 的人。展示逻辑住在产品 UI 和用户脚本里，不住在与写入共用的声明对象里。

## 7. 历史数据怎样面对 SDK、schema 与产品升级

产品事实：自托管升级步骤是停服务、升级包、若用数据库则跑 schema 迁移、再启动。官方不支持原地热升级。为减少停机，要用滚动替换和负载均衡。[UPGRADE]

```bash
mlflow db upgrade <backend-store-url>
```

产品事实：该命令用 Alembic 把库升到当前最新 schema。官方写明：迁移可能很慢，且不保证事务性。必须先备份。[UPGRADE] [STORE]

产品事实：语义化版本里，**数据库 schema 变更不要求 major bump**。major 只用于架构变化、删除公开 API、以破坏方式改公开参数。新增 API、新增可选参数、删除实验性 API 走 minor。[UPGRADE]

产品事实：SDK 与 Server 最好同版本。Server 对旧 SDK 做 best-effort，最多差一个 major，例如 2.x 客户端可以打 3.x 服务。新 SDK 打旧 Server 可能失败，例如 Tracing 端点不存在。[UPGRADE]

产品事实：`v3.15.1` 的 Alembic 目录包含追加 metric step、放宽 param 长度、`latest_metrics`、datasets、trace 表、assessments 表、logged model、evaluation datasets、scorer 表等 revision。这些是产品自己的表演进，不是用户自定义 family 的 migration。[MIG-DIR]

产品事实：FileStore（`./mlruns`）处于维护模式。官方建议用 `mlflow migrate-filestore` 迁到 SQLite。该工具要求 MLflow 3.10+，目标库必须为空，只支持 SQLite。它保留 ID 与时间戳，迁元数据，不搬 artifact 字节，也不把 span 从 artifact 搬进数据库。[FILEMIG]

产品事实：删除 Run 后元数据和 artifact 仍留着，以便恢复。永久清除要另跑 `mlflow gc`。[STORE]

产品事实：Scorer 旧 version 在删除前仍可 `get_scorer(version=...)` 取回。这是评估定义版本，不是把历史 Feedback 重写成新 schema。[SCORER-V]

产品事实：本次检查的一手公开面未提供“application maintainer 针对 exact snapshot 做 plan / authorize / receipt”的用户事实 migration。也没有把旧 param/metric 按用户声明 converter 重写的公共 API。

研究判断：MLflow 升级的是产品自己的 Tracking schema。用户扩展的名字和值跟着表走，不单独做版本族。升级后 UI 和 `search_runs` 继续按原 key 读。重新分析和报告是再查一次，不是从持久事件重建。

## 8. 四类作者各自看到几层

| 角色 | 默认入口 | 必须理解的层 | 不必理解的层 |
| --- | --- | --- | --- |
| 普通应用作者 | `autolog()` 或 `start_run` + `log_param` / `log_metric` | Experiment、Run、名字和值 | SQL 表、Alembic、Assessment envelope、OTLP 翻译 |
| 扩展作者 | `@scorer` / `make_metric` / `log_table` / `log_feedback` / 自定义 artifact | 固定 envelope 与 key 约定 | RecordAttachment family、installation、migration trust |
| 分析作者 | `search_runs`、`search_logged_models`、`load_table`、`MlflowClient` | 过滤 DSL、latest metric、NaN / NULL | UI chart 内部实现、Alembic revision |
| 报告作者 | Tracking UI，或 notebook 消费 DataFrame | 选 Experiment、比 Run、看图 | 没有独立 Report 声明层；也不拿 migration |

产品事实：官方把路径分成 Automatic Logging 与 Manual Logging。`mlflow.autolog()` 一行即可记下支持库的 param、metric、模型和训练图。[API]

产品事实：`MlflowClient` 被标为“直接对应 REST”的低层 CRUD。fluent 才管理 active run。[CLIENT] [PY-API]

产品事实：Python 的写入、搜索、Logged Model 最完整。Java / R 只有基础日志与有限搜索。REST 提供基础日志和搜索，不提供 autolog。[API]

研究判断：MLflow 实际是两层心智。一层是“往当前 Run 记名字和值”，一层是“用搜索和 UI 读回来”。扩展作者和分析作者仍站在同一 Run 信封上。没有第三层独立报告作者面，也没有与普通作者隔离的 adapter SPI。

NiceEval 建议：吸收“普通作者只看领域调用，搜索与 UI 共用同一持久事实”。不要吸收“扩展、分析、报告都直接摸同一 key-value Run”。

## 四个 NiceEval 场景

### 官方 OTel Timing

产品事实：MLflow Server 从 3.6.0 起暴露 OTLP/HTTP `/v1/traces`。需要 SQL Backend Store。客户端设 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 和 header `x-mlflow-experiment-id`。观察日仍不支持 OTLP/gRPC。[OTEL-IN]

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:5000/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS=x-mlflow-experiment-id=123
```

产品事实：入站时，内置 translator 把 OTel GenAI、OpenInference、Traceloop、Langfuse、Vercel AI SDK 等已知属性改写。目标字段包括 `mlflow.spanType`、`mlflow.spanInputs`、`mlflow.chat.tokenUsage`。UI 用这些字段选图标、填 Tokens 列。[OTEL-MAP]

产品事实：出站时，trace 默认带 `mlflow.*`。设 `MLFLOW_ENABLE_OTEL_GENAI_SEMCONV=true` 才译成 `gen_ai.*`。还可导出直方图 `mlflow.trace.span.duration`，单位毫秒，带 `span_type`、`span_status`、`experiment_id` 等标签。[OTEL-OUT]

产品事实：本次检查的一手公开面未提供“unknown OTel attribute 原字节闭包复制”或“Timing 作为版本化 RecordAttachment family”的契约。

研究判断：官方 Timing 在 MLflow 里是 span 起止与翻译后的 duration metric。它能回答延迟分布，不能回答 NiceEval 那种 sealed Timing view + 穷尽状态。

场景判断：用户代码或 OTel SDK 真实出 span，MLflow 写入并在同一 UI 展示。路径完整，但扩展单位是属性映射，不是版本化 Timing schema。

### 用户 GPU Energy

产品事实：官方系统指标已包含 `system/gpu_power_usage_watts` 和 `system/gpu_power_usage_percentage`。没有名为 energy / joules 的官方 metric。[SYS]

产品事实：用户若要记能量，公开面就是再写一条 metric 或 table：

```python
with mlflow.start_run():
    mlflow.log_metric("gpu_energy_joules", 12345.0, step=epoch)
    mlflow.set_tag("gpu.device", "0")
```

这是研究判断下的最小合法调用，不是官方 GPU Energy API。形状与 `log_metric` 文档一致。[FLUENT]

产品事实：本次检查的一手公开面未提供 GPU Energy 的 sealed domain value、adapter、installation 或领域 `analyzeGpuEnergy()`。

研究判断：第三方能量事实在 MLflow 里只能挤进名字和值。分析作者靠 `metrics.gpu_energy_joules` 过滤。报告作者靠 UI 把这条 metric 当普通曲线。旧数据不会因为 SDK 升级而改名或重写。

场景判断：路径能走通，但四类作者看到的是同一层 key。这正好对照 NiceEval 要把普通作者隔在 `gpuEnergy({ meter })` 之后。

### Assertion 与 Evidence

产品事实：最接近 Assertion 的官方对象是 Feedback / Expectation。它们挂在 Trace 或 Span 上，带 source、rationale，并且允许只记 evaluator 错误。[FB]

```python
mlflow.log_feedback(
    trace_id=trace_id,
    name="llm_judge_evaluation",
    error=AssessmentError(error_code="EVALUATION_FAILED", error_message=str(e)),
    source=AssessmentSource(
        source_type=AssessmentSourceType.LLM_JUDGE, source_id="gpt-4-evaluator"
    ),
)
```

这是官方 Feedback 指南里“评估失败也要落盘”的片段。[FB]

产品事实：公开 API 允许原地 `update_assessment` 和 `delete_assessment`。`override_feedback` 保留旧值但把它标 invalid。[FB] [ASSESS]

产品事实：本次检查的一手公开面未要求 Feedback 列出 evaluator 实际读过的 span、dataset row 或外部材料。也没有不可变 Claim identity。

研究判断：MLflow 证明“判断应独立于执行 trace，并单独写入失败”。它不证明判断必须不可变，也不证明 evidence 必须是可遍历闭包。

场景判断：Assertion 结果可以经 SDK 写入、经同一 UI 回看。Evidence 停在 rationale 与 metadata。不能把它当成 NiceEval AssertionResult 的完整先例。

### 旧数据升级后重新分析和报告

产品事实：升级数据库后，历史 param / metric / tag 仍按原 key 坐在同一张表里。`search_runs` 和 Tracking UI 继续用这些 key。官方没有“升级后必须重跑分析作业”的步骤。[UPGRADE] [SEARCH]

产品事实：FileStore 迁到 SQLite 时保留 ID 与时间戳。artifact URI 不变。span 仍在 artifact 里。迁完用 `mlflow server --backend-store-uri sqlite:///...` 打开，UI 应仍能看到 Experiment、Run 和 Model。[FILEMIG]

产品事实：schema 迁移可能改列宽或加表，例如 param value 从 500 扩到 8k 的 revision `2d6e25af4d3e` 被标为不可逆。这改变的是产品列，不是用户 payload 版本。[STORE] [MIG-DIR]

产品事实：本次检查的一手公开面未提供把旧 Feedback JSON 迁到新 envelope 的用户授权流程。也没有升级后自动重算 Report 的官方作业。

研究判断：MLflow 的“重新分析和报告”就是用新客户端再 search、再打开 UI。可信的是 key 还在。不可信的是 UI 翻译逻辑或 evaluator 定义若已变，同一旧 Run 可能画出不同图、得出不同解释。

场景判断：产品升级路径完整且有备份纪律。它不把历史重解释收成显式、可审计的 migration receipt。

## 产品事实、研究判断与 NiceEval 建议

下面三句话必须分开读。

产品事实：MLflow 让用户进程经 SDK 写入，经同一 Tracking Store 持久化，经同一搜索 API 和 UI 读取。写入主路径是固定信封里的名字和值。产品 schema 用 Alembic 升级，不要求用户为自定义事实声明 version family。

研究判断：这套模型对训练试验和超参比较足够。它弱在不可变评价、分母、coverage，以及把第三方事实收成独立版本族。作者分层主要是 fluent 对 Client 对 UI，不是 Record / Analysis / Report 三层。

NiceEval 建议：公共 API 应继续让普通作者只调用领域函数。搜索词和报告字段共用同一份已发布事实。不要把 MLflow 的“任意 key + 可变 Feedback + UI 自行画图”做成默认扩展面。

## 值得吸收 / 不应复制 / 尚缺证据

### 值得吸收

- 同一产品同时拥有运行写入、持久 store、查询 DSL 和官方 UI。分析不必另接 BI。
- 主写入 API 保持中立：`log_metric("accuracy", 0.95)` 不要求先选图表。
- 查询语言与 UI 过滤共用前缀 `metrics.` / `params.` / `tags.`。
- 嵌套 Run 与 `mlflow.parentRunId` 把一次试验和多次试次收成可检索的树。
- Assessment 把评价与执行分开，并允许只写入 evaluator error。
- 系统指标用 `system/` 前缀分组，避免和业务 metric 抢名字。
- 升级文档写清：备份、Alembic、schema 变更走 minor、新旧 SDK 的单向兼容。
- OTel 入站明确做已知字段翻译，而不是假装任意属性都是一等 Timing。

### 不应复制

- 用可变 Feedback / 可删 Assessment 冒充不可变评价事实。
- 用缺列 `NaN` 代替 Analysis 的分母、coverage 与 unsupported。
- 让普通作者、扩展作者、分析作者共用一条“任意 key + 任意 JSON”的写口。
- 把数据库 schema 变更放进 minor，却没有对用户自定义 payload 的显式 migration 授权。
- 让 Report 只存在于产品 UI 和用户 notebook，没有与 Analysis 字段闭合的声明。
- Resume 同一 `run_id` 继续追加，却对外说成已经封口的历史。
- 经典 `evaluate` 与 GenAI `evaluate` 两套不互通的评估系统并存，却共用“evaluation”这个词。

### 尚缺证据

- Tracking UI chart 与 run comparison 的完整交互契约。公开页只列能力，没有控件级规范。
- FileStore 以外的 Backend Store 是否对同一 `log_param` 长度、Infinity 替换有不同行为。文档只举 SQLAlchemy store 替换 ±Infinity。
- `log_table` JSON 的精确 schema，以及 UI 如何把它渲染成表。
- Assessment `metadata` 是否被搜索 DSL 索引。本次检查的一手公开面未提供。
- 升级后旧 UI 翻译规则是否保证同一 span 仍映射到同一 `mlflow.spanType`。
- 官方是否计划为自定义事实提供版本化 schema。本次检查的一手公开面未提供该路线。
- Databricks 托管 Tracking 与开源 Server 在 resume、删除、评估页上是否同一契约。本文只采用开源官方文档与 `v3.15.1` 源码。
