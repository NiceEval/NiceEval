# MLflow Tracing、Assessment 与 Evaluation Dataset

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页只写 MLflow 自己拆出的 GenAI 产品面。
部件归属见 [Layers](layers.md)。
发起到收尾见 [Execution](execution.md)。
表、目录和 `traces.json` 见 [Storage](storage.md)。
Traces 页与 `search_traces` 见 [Reading and comparison](reading-and-comparison.md)。
Alembic 与 FileStore 迁移见 [Schema and migration](schema-and-migration.md)。

## 这套产品面是什么

Trace 保存一次应用执行的 span tree。
Assessment 是挂在 Trace 或 Span 上的独立对象，类型是 `feedback`、`expectation` 或 `issue`。

Evaluation Dataset 是持续增长的测试集合。
它保存 inputs、可选 outputs、expectations 与 tags，并可从生产 Trace 收录测试行。
官方页写明它需要 SQL Backend Store，FileStore 不可用。
见 [Evaluation Dataset concepts](https://mlflow.org/docs/latest/genai/concepts/evaluation-datasets/)。

```text
用户应用 / OTel SDK / @mlflow.trace
        │
        ▼
TraceInfo + Spans + Assessments
        │
        ▼
Tracking UI Traces 页、mlflow traces CLI、search_traces、genai.evaluate
```

这一面与 Run 共用 Tracking Server 和 UI，但 Assessment 不是 Run 上的 metric。
把 Trace 链到 Run 要另写 `entity_associations`，且 FileStore 拒绝该动作。

## OTel 进出站

产品事实：MLflow Server 从 3.6.0 起暴露 OTLP/HTTP `/v1/traces`。
需要 SQL Backend Store。观察日仍不支持 OTLP/gRPC。
客户端设 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 和 header `x-mlflow-experiment-id`。
见 [Collect OpenTelemetry Traces](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/ingest/)。

产品事实：入站 translator 只改写已知 OTel GenAI、OpenInference、Traceloop、Langfuse、Vercel AI SDK 属性。
目标字段包括 `mlflow.spanType`、`mlflow.spanInputs`、`mlflow.chat.tokenUsage`。
见 [Attribute Mapping](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/attribute-mapping/)。

产品事实：出站时，trace 默认带 `mlflow.*`。
设 `MLFLOW_ENABLE_OTEL_GENAI_SEMCONV=true` 才译成 `gen_ai.*`。
还可导出直方图 `mlflow.trace.span.duration`。
见 [Export via OTLP](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)。

本次检查的一手公开面未提供 unknown attribute 的原字节闭包复制。

`observe-with-traces` 与 `assessments` 首页在观察日有一次抓取失败或返回空壳。
以上以同站子页、API 和 `v3.15.1` 源码为准。

## Assessment 作为评价对象

公开字段是 `name`、`value`、`rationale`、`source`，以及可选 `error` / `metadata` / `span_id`。
`value` 可以是数字、布尔、分类标签或结构化 dict。
失败可以只写 `AssessmentError`，不写分数。
见 [Feedback Collection](https://mlflow.org/docs/latest/genai/assessments/feedback/) 与 [`mlflow/tracing/assessment.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracing/assessment.py)。

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

产品事实：公开 API 允许后补、原地 update、delete 和 override。
它不是不可变评价事实，也不要求列出 evaluator 实际读过的 span 或 dataset row。
写入时序见 [Execution](execution.md)。

## Evaluation Dataset 与 Scorer

`mlflow.genai.datasets.EvaluationDataset` 的公开字段包括 `dataset_id`、`name`、`digest`、`schema`、`profile`、`tags`、`experiment_ids`。
测试行按 `input_hash` merge 相同 input 上的 expectations 与 tags。
这适合 curating，却不是固定 Sample。
见 [Evaluation Dataset concepts](https://mlflow.org/docs/latest/genai/concepts/evaluation-datasets/)。

产品事实：Scorer 可以按 Experiment 注册。
第一次注册是 version 1，同名再注册递增。
Code-based scorer 与 Guidelines judge 不支持这条注册面。
见 [Registering and Versioning Scorers](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/versioning/)。

产品事实：`mlflow.models.evaluate` 的 `EvaluationMetric` 不能用于 `mlflow.genai.evaluate()`。
`Scorer` 也不能用于 `mlflow.models.evaluate()`。
两套评估共用 “evaluation” 这个词，但不是同一系统。
见 [Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/) 与 [LLM and Agent Evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/)。

## 这一面在 FileStore 上缺什么

| 能力 | SQL | FileStore |
| --- | --- | --- |
| TraceInfo / tags / Assessment YAML | 表 | 目录与 YAML |
| `log_spans` 进 `spans` 表 | 支持，deadlock 可重试 | 不支持 |
| `query_trace_metrics` | 支持 | `@filestore_not_supported` |
| Evaluation Dataset CRUD | 支持 | `@filestore_not_supported` |
| `link_traces_to_run` | `entity_associations` | 明确报错 |
| OTLP `/v1/traces` | Server + SQL | 不可用 |

`mlflow migrate-filestore` 保留 Trace ID，但不把 span 从 artifact 灌进 `spans` 表。
见 [Schema and migration](schema-and-migration.md)。

## 未公开

- Databricks 托管 Trace 存储格式
- UI 控件级 Trace 比较契约
- Assessment `metadata` 是否进入 Run 的 `filter_string`
