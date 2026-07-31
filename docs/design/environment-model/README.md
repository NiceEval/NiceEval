# 环境模型:三份 Requirement 与唯一 Base Case

一次 Attempt 要同时满足三份要求:Eval 的题目环境、Experiment 的实验条件、Agent 的运行条件。
前两份要求既可能自带启动基底,也可能在别人的基底上补齐;Agent 只在最终主 Sandbox 中检查并补齐。

这个决策主题回答三个问题:

- 三份要求怎样归一成一个可验证的最终环境。
- Eval 与 Experiment 都提供不可叠加的 image、template、snapshot 或 Compose case 时怎样显式解决冲突。
- 一组 Eval 需要不同基底时,Experiment 怎样按 environment profile 选择已经融合实验条件的完整 case。

本主题保留完整 Sandbox Case 与 Agent Ensure 的领域义务,重新比较普通 Addon 与更一般的 Requirement + Base Case + Ensure 模型。
Requirement 是内部组合语言;普通作者仍使用题目环境、实验工具与 Adapter 各自的领域 helper。

五个 PLAN 都按 Feature Design Package 独立给出 Library、Architecture、Lifecycle 与 Use Case。
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
[DECISION](DECISION.md)
