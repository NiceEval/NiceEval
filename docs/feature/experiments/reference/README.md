# Experiments 设计参照

这里保存外部方案对 NiceEval Experiments 的启发与明确未采用的边界。它们是决策证据，不是目标 API；目标契约只看上级 [README](../README.md)、[Architecture](../architecture.md) 与 [Library](../library.md)。

- [Vercel agent-eval](agent-eval.md) —— 从 `ExperimentConfig` 学到运行矩阵，同时拒绝把评分和业务字段带进 Experiment。

参照文档只回答三件事：外部方案是什么、NiceEval 学了什么、NiceEval 没跟什么。实现顺序与阶段计划不放在这里。
