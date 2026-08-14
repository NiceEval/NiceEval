# LangSmith：Run、Feedback、Dataset 与 Trace View

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 一手材料

- [Run data format](https://docs.langchain.com/langsmith/run-data-format)
- [Feedback data format](https://docs.langchain.com/langsmith/feedback-data-format)
- [Manage datasets](https://docs.langchain.com/langsmith/manage-datasets)
- [Example data format](https://docs.langchain.com/langsmith/example-data-format)
- [View traces](https://docs.langchain.com/langsmith/view-traces)
- [Messages view trace format](https://docs.langchain.com/langsmith/messages-view-trace-format)
- [Administration and retention](https://docs.langchain.com/langsmith/administration-overview)

## Run 与 Feedback

LangSmith 把 Span 保存为 Run record。
低层 ingest 可以先 POST Run，再 PATCH output、error 或 end time；它是可完成和更新的 record，不是提交后永不改变的 revision。

Feedback 是独立 record，关联 `run_id`，并带 score、value、comment、correction、source metadata 和 modified time。
它支持 Observation/Claim 分层方向，却没有 immutable Claim 或 tracked basis 的公开保证。

## Dataset 与 lineage

Dataset 每次 add、update 或 delete example 都创建新 version。
过去版本只读，可通过 `as_of` 或 tag 读取并执行 evaluation。
Example 还能保存 `source_run_id`，说明生产 trace 进入 dataset 时需要 lineage。

LangSmith trace 还有 retention tier 和删除能力。
固定 dataset version 不能保证 producer Run、Feedback 和 projection logic 永久存在。

## Messages、Turns 与 Details

LangSmith 最值得吸收的是 Messages、Turns 和 Details 的读面分层。
普通用户看到对话，诊断者可以下钻原始 Run tree。
无法识别某种格式时，Messages adapter 会明确失败，而不是静默猜测。

这仍不是 NiceEval Projector 的完整先例。
Messages extraction 依赖 integration metadata、payload shape 和 adapter logic，没有公开固定 projector version、参数或 `basedOn`。
同一旧 Run 可能随 UI 或 adapter 升级产生不同展示。

## 对 NiceEval 的启发

- 同时提供友好 Projection 和原始 Evidence view。
- 无法解释 payload 时返回明确 unsupported adapter，不猜字段。
- trace 进入 dataset 时保存双向 lineage，而不只复制 input 文本。
- Projector identity、version、参数和 GraphRef 必须进入 memo 与审计面。
