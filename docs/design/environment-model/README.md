# 环境模型:Environment 解析与三方条件收敛

一次 Attempt 先解析唯一 Sandbox Case,再由 Experiment sandbox setup、EvalDef setup 与 Agent setup 分层准备。
Eval 可以声明 Environment source/profile,数据集 adapter 也可以从原始 task package 派生它。

这个决策主题回答三个问题:

- Eval Environment 与 SandboxConfig defaultEnvironment 怎样解析成唯一 Sandbox Case。
- Experiment 与 Eval 怎样在该 Sandbox 中分别准备自己的条件。
- 现场安装不可行时,SandboxConfig 怎样按 environment profile 选择预制的完整 Case。

本主题保留完整 Sandbox Case 与 Agent Ensure 的领域义务。
普通作者使用 Environment、SandboxConfig、运行中的 Sandbox 与现有 setup 层，不学习 materializer 注册或通用 Requirement/Base 组合语言。

八个 PLAN 都按 Feature Design Package 独立给出 Library、Architecture、Lifecycle 与 Use Case。
[Cases](CASES.md) 固定共同输入和验收结果;候选用例只说明各自怎样覆盖,不能改写 Case 来降低要求。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[CASES](CASES.md) ·
[PLAN-1](PLAN-1/README.md) ·
[PLAN-2](PLAN-2/README.md) ·
[PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) ·
[PLAN-5](PLAN-5/README.md) ·
[PLAN-6](PLAN-6/README.md) ·
[PLAN-7](PLAN-7/README.md) ·
[PLAN-8](PLAN-8/README.md) ·
[DECISION](DECISION.md)
