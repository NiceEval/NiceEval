# Phoenix Evaluator 可观察性

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 一手材料

- [OpenInference specification](https://arize-ai.github.io/openinference/spec/)
- [Annotation concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)
- [Span Annotations](https://arize.com/docs/phoenix/sdk-api-reference/typescript/packages/phoenix-client/span-annotations)
- [Updating datasets](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/updating-datasets)
- [LLM evaluators](https://arize.com/docs/phoenix/evaluation/server-evals/llm-evaluators)

Phoenix 使用 OpenInference 表达 AI trace。
OpenInference 是建立在 OpenTelemetry 上的 semantic convention，定义 LLM、tool、retrieval 等 span kind 和属性。

Phoenix 把 Span 与 Annotation 分开。
Annotation 可以标明 HUMAN、LLM 或 CODE annotator，并携带 label、score 和 explanation。
这与 Observation/Claim 的概念边界高度一致。

结构化 Annotation 仍是 upsert。
默认对同一 span/name 再写会原地替换；`identifier` 可让多个 annotator 或 evaluator version 共存，但相同 key 仍会更新。
它不等于不可变 Claim history。

Dataset update 会生成新 `version_id`，Experiment 可以固定该 version。
生产 Span 进入 Dataset 时还能建立 dataset example 与 source Span 的双向链接。

LLM evaluator 的 prompt、model 和 invocation parameters 会版本化。
每次 evaluator 调用还生成独立 OTel Trace，用户可以从 Annotation 下钻 judge request、response、token 和 latency。

这是 NiceEval 最应该吸收的产品路径：

```text
被评执行 Span
  ├─ evaluator execution Trace
  └─ Annotation score
```

NiceEval 应进一步把 evaluator execution 存成 Observation，把 score/verdict 存成 immutable Claim，并让框架生成实际读取 basis。
judge Trace 的存在本身不证明 evidence closure 完整。
