# MLflow Tracing、Assessment 与 Evaluation Dataset

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 一手材料

- [Trace concepts](https://mlflow.org/docs/latest/genai/tracing/observe-with-traces/)
- [Assessments](https://mlflow.org/docs/latest/genai/assessments/)
- [Evaluation Dataset concepts](https://mlflow.org/docs/latest/genai/concepts/evaluation-datasets/)
- [Build datasets from traces](https://mlflow.org/docs/latest/genai/datasets/)
- [OTLP export](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/export/)
- [OpenTelemetry attribute mapping](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/attribute-mapping/)

## Trace 与 Assessment

MLflow Trace 保存应用执行的 span tree。
Assessment 是独立对象，用于 feedback、expectation 或 evaluation result，并带 source、rationale 等字段。

这是 Observation 与 Claim 最直接的领域先例之一：

- Span 保存模型调用、tool、retrieval 和应用步骤。
- Assessment 保存人工、代码或模型 evaluator 对 trace/span 的判断。
- evaluator failure 可以与判断结果分开反馈。

边界也很明确。
Assessment 没有强制 `basedOn` 列出 evaluator 实际读取的 span、dataset row 或外部材料。
公开 API 允许 update 或 delete，因而不是不可变 Claim。

## Evaluation Dataset

Evaluation Dataset 是持续增长的 collection。
它有 content digest、record source 和 schema/profile；相同 input 还可以 merge expectations 与 tags。
这适合 curating workflow，却不等同于固定的 Sample 或 Record revision。

MLflow 可以接收和导出 OTLP，并在 MLflow、OpenInference 与 OTel GenAI 属性间转换。
这种 translation 只处理已知字段，不提供 unknown payload 的 raw-byte round trip 或 strong-closure traversal。

## 对 NiceEval 的启发

- 保留 Assessment 式领域动词，不让普通 evaluator 构造任意 Claim JSON。
- evaluator request/response 进入 Observation，score/verdict 进入 Claim。
- supersession 应创建新 Claim 并保留旧值，不就地 update。
- schema translation 属于 interop Projector，不能改写 durable Observation。
