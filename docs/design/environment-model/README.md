# 环境模型:完整 Sandbox Case 与可组合 Addon

Eval 与 Experiment 都会影响 Sandbox 里有什么,但两者表达的不是同一类事实。
Eval 声明题目环境;Experiment 选择 Provider,并可以补充本次实验需要的工具;Adapter 负责确保 Agent 可用。

这个决策主题回答三个问题:

- 怎样让自带 Compose 或 Dockerfile 的 Eval 保留完整题意,同时允许 Provider 使用预制产物替代现场构建。
- 怎样让 Experiment 添加工具时只写一个低成本安装单元,不用手写 manifest 或维护隐式顺序。
- 怎样复用安装调度能力,但不抹掉 Sandbox Case、实验工具与 Agent 安装各自的生命周期和身份边界。

候选项从「按来源拆协议」走到「把全部安装统一成 Layer」,最终选择中间路线:保留完整 Sandbox Case 与独立 Agent Ensure,只为 Experiment 工具建立 Addon 协议。
Addon 默认串行;声明资源与依赖后,调度器在不冲突的部分并行。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[PLAN-1](PLAN-1.md) ·
[PLAN-2](PLAN-2.md) ·
[PLAN-3](PLAN-3.md) ·
[DECISION](DECISION.md)
