# W&B Weave：Op、Call、Object 与 Feedback

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 一手材料

- [Ops, Calls, and Traces](https://docs.wandb.ai/weave/guides/tracking/tracing)
- [Track and version objects](https://docs.wandb.ai/weave/guides/tracking/objects)
- [Call schema](https://docs.wandb.ai/weave/guides/tracking/call-schema-reference)
- [Feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)
- [Datasets](https://docs.wandb.ai/weave/guides/core-types/datasets)
- [Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval)

## Op、Call 与 Object

Weave 的 Op 是 versioned function，Call 是一次执行，Trace 是共享 trace ID 的 Call tree。
Object 可以保存 Dataset、Model、Prompt 或其它 JSON-serializable data。

Object 内容变化会产生新 version。
ref 可以使用 hash、`vN` 或 movable alias；精确 ref 最接近 NiceEval NodeRef 的用户体验。

官方也允许删除某个 Object version。
查找引用已删除对象的 graph 时会出现 `DeletedRef`。
这里的 immutable 表示已发布 version 不就地修改，不代表永久 retention。

## Dataset、Evaluation 与 Feedback

Dataset 是 versioned Object，Evaluation 可以引用 dataset、model 和 scorer。
evaluation export 还给出 `row_digest`，按行内容而不是位置对齐两次评测。

这些 identity 各有正确作用域：

- Object ref 固定某个配置或 dataset version。
- `row_digest` 固定某个 eval row。
- Call ID 固定执行事实对象。
- Feedback 是另一个可添加、查询或 purge 的平面。

它们没有共同的 project/record revision root。
一组精确 ref 也不会自动证明所有依赖都已闭合并可离线复制。

## 对 NiceEval 的启发

- 普通探索可以默认 latest，receipt、Sample 和 Report 必须保存 exact ref。
- 删除后返回具名 deleted/unavailable，不能折成 `null`。
- evaluator definition、dataset 和 model 都要有稳定 identity。
- leaf digest 只回答叶身份，不能冒充整个 RecordGraphRef。
