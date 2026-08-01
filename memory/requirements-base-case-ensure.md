# 三份 Requirement、唯一 Base Case 与 Ensure

> 2026-08-01 被 [[sandbox-layer-model-adopted]] 替代:环境模型最终采纳 PLAN-10 的 SandboxLayer 模型,Requirement / Base Case / Ensure 词族不进入公开契约。

## 裁决

2026-07-31,环境模型采用 PLAN-4:先区分三份 Requirement,再用 Base Case 或 Ensure 兑现。

- Eval Requirement 保存题目环境事实。
- Experiment Requirement 保存实验工具、模型与证书等比较条件。
- Agent Requirement 由 AgentProvisioner 保存,不参与 Base Case 选择。
- Base Case 是单条 Attempt 唯一的完整 Sandbox Case 启动基底。
- Eval 与 Experiment 都可以提供 Base 或 Ensure;Agent 只提供 Ensure。
- 双 Base 没有隐式优先级。Experiment 必须按 Eval profile 提供显式融合 case,否则启动期报冲突。
- 一次 Experiment 可以声明多个候选 case,但每条 Attempt 只选择一个。
- Base 来源不受信;三份 Requirement 仍以运行事实验证,安装后复检。Sandbox Case 的 ready、能力与身份可以直接构成验证。

## 推翻了什么

本裁决替代 [sandbox-case-addon-agent-provisioner](sandbox-case-addon-agent-provisioner.md) 的 PLAN-3 结论。
PLAN-3 正确保留了完整 Sandbox Case 与 AgentProvisioner,但固定了「Eval 给 Base、Experiment 给 Addon」的单向组合。

PLAN-4 将 Addon 保留为 Experiment Requirement 的普通 helper,同时允许 Experiment 提供 Base、Eval 提供可移植 Ensure。
PLAN-3 因而成为「Eval 总提供 Base、Experiment 总提供 Ensure」时的严格子集。

## 为什么不是 template 模型

用户提出的关键组合是「Eval 与 Experiment 都可能选 template,双选冲突;不同 Eval 可以切换 template」。
提升到跨 Provider 模型后,template 只是 E2B 的一种 case 输入;Docker Compose、image 与 Vercel snapshot 同样需要组合。

因此 Goal 使用 Base Case 而不是 template:

- 单 Attempt 只选一个 Base Case。
- 多个候选 Base Case 可以按 Eval profile 切换。
- 两个独立 Base Case 不由 Runner 合并;显式融合 case 承担组合成本。

## 保留的不变量

- Eval 不选择 Provider。
- 完整 Sandbox Case 继续拥有 BuildKey、CaseKey、主 Sandbox、能力、证据与清理。
- AgentProvisioner 继续拥有 staged payload、平台探测、安装模式与 Agent 运行事实。
- Requirement 是内部组合协议;普通作者使用 `composeSandbox`、实验工具 helper 与 Adapter 工厂。
- Fixture、状态 Hook 与宿主侧外部服务不进入 Requirement。
