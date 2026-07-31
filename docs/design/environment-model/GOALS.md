**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 目的

决定 Eval 题目环境、Experiment 工具安装与 Agent 安装怎样组合。
范围覆盖公开声明模型、身份归属、检查契约与安装调度。
跨 Attempt 状态复用见 [Experiment Speed](../experiment-speed/README.md),多容器运行义务见 [多容器环境](../multi-container-environments/README.md)。

## 设计原则

- 用户给实验添加一个普通工具时,只承担该工具本身的身份、检查与安装逻辑。
- 相似的安装动作可以共享调度设施,但领域身份、生命周期、错误归属和运行事实不能因此合并。
- 并行是可证明无冲突后的优化。未知安装单元按保守顺序执行,不把竞态风险交给作者发现。
- 预制产物是检查命中的优化,不是跳过真实状态验证的依据。

## 需求

1. 自带 Compose 或 Dockerfile 的 Eval 只声明题目环境与主执行空间,不注册普通 Provider 已经内建的转换器。
2. Provider 可以按 environment profile 提供完整预制 Sandbox Case,替代现场构建而不改变 Eval。
3. 给 Experiment 加一个工具只需声明一个 Addon;框架承担组合、调度、诊断与结果落盘。
4. Addon 必须检查实际状态;安装后复检。受管 manifest 只能加速检查,不能代替检查。
5. 用户不维护数组顺序。未知 Addon 默认串行;声明资源与依赖后,互不冲突的 Addon 自动并行。
6. Agent 安装继续由 Adapter 的 AgentProvisioner 拥有;它可以复用安装资源调度器,但不伪装成普通 Addon。
7. Sandbox Case、Addon 与 AgentProvisioner 的身份分别进入正确的逐 Eval fingerprint 或 Run 级 configHash,且都有可解释的落盘形状。

## 不是本 doc 的目标

- 不改变 `sandboxReuse` 的语义与默认值。
- 不统一 Fixture、状态 Hook、外部服务与 Sandbox 内工具安装。
- 不重新定义多容器 case 的启动、就绪、证据、清理与留存义务。
- 不建立跨 Provider 的安装步骤 DSL。
