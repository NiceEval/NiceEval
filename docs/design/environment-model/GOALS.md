**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [DECISION](DECISION.md)

---

## 目的

决定 Eval Environment、Experiment SandboxSpec 与三层 setup 怎样形成最终 Sandbox。
范围覆盖起点解析、准备动作归属、真实检查、身份与错误记录。

跨 Attempt 状态复用见 [Experiment Speed](../experiment-speed/README.md),多容器运行义务见 [多容器环境](../multi-container-environments/README.md)。

## 设计原则

- 环境选择与环境准备分开。每条 Attempt 只解析一个 Sandbox Case。
- Eval source 可以由作者声明,也可以由数据集 adapter 从原始 task package 派生。
- 准备动作按 Experiment sandbox、Eval、Agent 三个既有 owner 归位,不再建立通用 Environment contribution。
- 预装产物是优化。需要判断命中时,领域 helper 必须检查实际状态并在安装后复检。
- 作者看到的顺序就是执行顺序。没有真实需求时不引入依赖 DAG、资源锁与自动并行。
- build、start、setup、Fixture、hidden criteria、Agent 结束边界与活 Sandbox 复用是不同动作。
- 逐题 Eval 保持自包含；生命周期机械动作由字段归属表达，不靠模块顶层登记副作用。

## 需求

1. Eval 自带 profile/source 时,SandboxSpec 必须兑现它;默认 template 不能静默替代题目环境。
2. Eval 不带 Environment 时,SandboxSpec 默认 image/template/snapshot 可以成为起点。
3. 外部 benchmark 的 task package 可以通过 adapter 批量迁移,不要求逐题复制环境声明。
4. Experiment sandbox setup 必须作用于最终选中的主 Sandbox,无论它来自 Eval source 还是默认 case。
5. EvalDef setup 必须作用于最终选中的主 Sandbox,无论默认 case 由哪个 Experiment 选择。
6. Agent 安装保持独立 owner,在 Environment 与题目准备完成后执行。
7. 现场无法组合时,SandboxSpec 可以按 profile 提供完整预制 case;Runner 不合并两个起点。
8. setup 的 identity、activity、失败 phase 与可验证 helper 的实际 facts 必须进入正确记录。
9. 普通作者只需理解 Environment、Experiment sandbox setup、Eval setup 与 Agent setup。
10. 可见 Fixture 与隐藏 criteria 必须在 EvalDef 内声明；`afterAgent` 显式关闭 Agent 驱动面，callback 继续使用普通 Sandbox API。
11. 每题可以完整重复自己的定义，不要求用数据集 adapter 或共享 Eval 工厂消除重复。

## 不是本 doc 的目标

- 不定义通用 Requirement/Layer/Addon DSL。
- 不自动推导 setup 依赖、资源锁或并行调度。
- 不改变 `sandboxReuse` 的语义与默认值。
- 不定义外部实验状态的 checkpoint、后继和失败提交策略。
- 不重新定义 Agent runtime。
- 不重新定义多容器 case 的 ready、证据、清理与 retain/resume 义务。
- 不建立跨 Provider 的安装步骤 DSL。
