# MLflow Reading：重开、查询、比较与缺测

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页写历史怎样被人重新看见。
持久形状见 [Storage](storage.md)。
完成态与软删除见 [Execution](execution.md)。

## 用户入口

| 入口 | 作用 | 用户不必看见 |
| --- | --- | --- |
| Tracking UI | Experiment 列表、跨 Experiment 比较、按 param / metric 搜、画 metric 图、下载 artifact | SQL 表、Alembic、`mlruns` 目录 |
| `mlflow server` | 同时提供 UI 与 REST | 默认 `sqlite:///mlflow.db` |
| `mlflow.search_runs` / `MlflowClient.search_runs` | 过滤、排序、取 DataFrame 或 `Run` 列表 | UI chart 实现 |
| `mlflow.search_logged_models` | 按 metric / param 搜 checkpoint，可限制 dataset | 旧的 `runs:/<run_id>/path` |
| `mlflow.load_table` | 把多次 Run 的同名 JSON 表拼回 DataFrame | 独立 Report 对象 |
| `mlflow runs list/describe/delete/restore` | 终端列出、导出 JSON、软删与恢复 | store 实现 |
| `mlflow experiments search/get/csv` | Experiment 级列表与 CSV 导出 | 表结构 |
| `mlflow.search_traces` / `mlflow traces *` | Trace 与 Assessment | span 表或 `traces.json` |
| Tracking UI Traces 页 | 单条 Trace 明细与评价 | OTel 翻译规则 |

本地打开方式见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)：

```bash
mlflow server --port 5000
```

浏览器访问 `http://127.0.0.1:5000`。
远程则访问 Tracking Server 的同一 UI。

默认搜索视图是 `ACTIVE_ONLY`。
被删 Run 仍可用 `DELETED_ONLY` 或 `ALL` 读回，也可用 `restore_run` 恢复。
见 [`ViewType`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/view_type.py) 与 [Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/)。

## Query 与 filter

产品事实：UI 与 Python 共用一套 SQL 风格 `filter_string`。
它受 SQL 启发，但不是完整 SQL。明确不支持 `OR`。
见 [Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/)。

可过滤前缀：`metrics.`、`params.`、`tags.`、`datasets.name` / `digest` / `context`，以及 `attributes.run_id` 等 Run 元数据。

| 字段类 | 比较 | 缺测怎样出现 |
| --- | --- | --- |
| metric | `>` `>=` `<` `<=` `=` `!=` | 该 Run 没有这个 key 时，pandas 列是 NumPy `NaN` |
| param / tag | `=` `!=` `LIKE` `ILIKE`，以及 `IS NULL` / `IS NOT NULL` | 缺列是 `None` |
| dataset / `attributes.run_id` | 另允许 `IN` | 无该 dataset 则滤掉 |

产品事实：param 在 store 里是字符串。看起来像数字也必须加引号。

产品事实：`search_runs(..., output_format="pandas")` 默认最多 100,000 行。
Client `search_runs` 的 store 上限是 50,000，默认页大小 1,000。
见 [`fluent.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/fluent.py) 与 [`mlflow/store/tracking/__init__.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/__init__.py)。

产品事实：本次检查的一手公开面未提供 search DSL 里的 `GROUP BY`、分母声明或 `unsupported`。
聚合发生在取回 DataFrame 之后，或发生在 UI chart 里。

FileStore 的 `_search_runs` 先列出目录里的全部 Run，再在进程内用 `SearchUtils.filter` / `sort` / `paginate`。
SQL 把过滤下推到表，列表读的是 `latest_metrics`。
两边公开 DSL 相同，实现成本不同。
见 [`FileStore._search_runs`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py)。

## Align、group 与 compare

产品事实：对齐单位是 metric / param / tag 的名字。
同名列排在同一张比较表里。没有该名字的 Run 留下空单元格。
见 [Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/) 与 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)。

产品事实：分组靠 Experiment、嵌套 Run 的 `mlflow.parentRunId`，以及用户 tag。
超参教程用父 Run 包住多次 `nested=True` 子 Run，再点 UI chart 图标看 tuning。
见 [Hyperparameter Tuning](https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/)。

产品事实：MLflow 3 的 `search_logged_models` 可以按 dataset 限制比较口径，避免把不同测试集上的 metric 混在一起。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)。

产品事实：`load_table` 按 artifact 路径对齐多次 Run 的 JSON 表，可用 `extra_columns=["run_id"]` 补身份。
见 [Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)。

## Render

产品事实：Tracking UI 从已写入的 metric / param 画图和列表。
作者调用 `log_metric` 时不声明 chart type。

产品事实：`log_figure` / `log_image` 直接保存可显示文件。
`mlflow.models.evaluate` 按 `model_type` 自动生成混淆矩阵、ROC 等 artifact。
见 [Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/)。

产品事实：系统指标出现在 UI 的 metrics 区，前缀是 `system/`。
文档没有要求作者再声明一张系统指标图。
见 [System Metrics](https://mlflow.org/docs/latest/ml/tracking/system-metrics/)。

产品事实：本次检查的一手公开面未提供与写入 API 共用的 Report 声明对象，也没有独立 Dashboard SDK。
Tracking UI chart 与 run comparison 的控件级契约同样未公开。

## Trace 阅读面

产品事实：`search_traces` 默认最多 100 条。
过滤面是 Trace 元数据、tag 和已写入的 `trace_metrics`，不是任意 span attribute 的完整 SQL。
见 [`SEARCH_TRACES_DEFAULT_MAX_RESULTS`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/__init__.py)。

产品事实：UI 用翻译后的 `mlflow.spanType` 选图标，用 `mlflow.chat.tokenUsage` 填 Tokens 列。
这是读取时的展示映射。升级 translator 可能改变同一旧 span 的显示，而不改 `content` JSON。
见 [OpenTelemetry attribute mapping](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/attribute-mapping/)。

产品事实：SQL `get_trace(allow_partial=False)` 在 span 尚未全部导出时返回“not fully exported yet”。
缺测在这里表现为 partial Trace，而不是 `NaN` 单元格。
见 [`SqlAlchemyStore.get_trace`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

产品事实：Assessment 的搜索入口是 Trace 页和 `mlflow traces get-assessment`。
本次检查的一手公开面未写明 `assessment_metadata` 是否进入 Run 的 `filter_string`。

研究判断：MLflow 能选出 Run 并承认“这一格没有值”。
它不把 missing、partial、unsupported 收成分析层的穷尽状态。
分母和 coverage 要作者自己用 pandas 算。
重新分析和报告就是再 search、再打开 UI，不是从事件日志重建。
