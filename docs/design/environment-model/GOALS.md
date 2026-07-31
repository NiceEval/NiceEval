**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [DECISION](DECISION.md)

---

## 目的

决定 Eval 题目环境、Experiment 实验条件与 Agent 运行条件怎样组合成最终 Sandbox。
范围覆盖公开声明模型、基底选择、身份归属、检查契约与安装调度。
跨 Attempt 状态复用见 [Experiment Speed](../experiment-speed/README.md),多容器运行义务见 [多容器环境](../multi-container-environments/README.md)。

## 设计原则

- Eval、Experiment 与 Agent 各自拥有一份要求;没有一方通过选择起点产物覆盖另一方的要求。
- 每条 Attempt 只有一个 Base Case。多个可选 case 可以服务不同 Eval,但同一条 Attempt 不合并两个基底。
- 相似的安装动作可以共享调度设施,但领域身份、生命周期、错误归属和运行事实不能因此合并。
- 并行是可证明无冲突后的优化。未知安装单元按保守顺序执行,不把竞态风险交给作者发现。
- 预制产物是检查命中的优化,不是跳过真实状态验证的依据。
- build、start、install、Fixture 与活 Sandbox 复用是五种不同动作;每个候选必须给出各自完整 Lifecycle。

## 需求

1. 一次 Attempt 必须同时满足 Eval Requirement、Experiment Requirement 与 Agent Requirement。
2. Eval 与 Experiment 都可以提供 Base Case,也可以提供在其它 Base Case 上收敛自身 Requirement 的 Ensure。
3. Eval 与 Experiment 同时提供独立 Base Case 时不隐式决定优先级;配置必须显式提供融合 case,否则启动期报冲突。
4. Experiment 可以按 Eval environment profile 声明多个融合 case。每条 Attempt 只选择一个,不同 Eval 可以选择不同 case。
5. 只有一侧提供 Base Case 时,另一侧必须通过 Ensure 收敛;无法收敛的组合有明确的不兼容结果。声明期可判的缺失在创建 Sandbox 前报出,依赖运行事实的验证在进入 Agent 阶段前判明。
6. 三份 Requirement 都必须由运行事实验证。Sandbox Case 的 ready、能力与身份可以构成验证;安装后复检。预制产物名与受管 manifest 不能单独代替验证。
7. 用户不维护安装数组顺序。未知安装默认串行;声明资源与依赖后,互不冲突的安装自动并行。
8. 三份 Requirement、所选 Base Case 与解析后的 Ensure 身份进入正确的 configHash 或逐 Eval fingerprint,且都有可解释的落盘形状。
9. 起点产物只有与 Experiment Requirement 绑定声明时才构成 Experiment Base;Experiment 单纯选择运行产物不与 Eval Base 冲突。
10. 外部实验状态有独立的 identity、load/save cadence、后继 checkpoint、失败提交策略和穷尽活动;它不借用早期 SandboxSpec setup,也不伪装成 Requirement 或 Fixture。
11. Agent CLI 安装与逐 Attempt runtime setup 分段建模;鉴权、配置、Plugin、Skill 与 MCP 必须可验证,turn 后隐藏 verifier 不能提前泄露,复用前必须成对 cleanup。

## 不是本 doc 的目标

- 不改变 `sandboxReuse` 的语义与默认值。
- 不统一 Fixture、状态 Hook 与外部服务。
- 不重新定义多容器 case 的启动、就绪、证据、清理与留存义务。
- 不建立跨 Provider 的安装步骤 DSL。
