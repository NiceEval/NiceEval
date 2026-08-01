**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [DECISION](DECISION.md)

---

## 目的

决定 Eval Environment、Experiment 的 Sandbox 配置与三层 setup 怎样形成最终 Sandbox。
范围覆盖起点解析、准备动作归属、真实检查、身份与错误记录。

跨 Attempt 状态复用见 [Experiment Speed](../experiment-speed/README.md),多容器运行义务见 [多容器环境](../multi-container-environments/README.md)。

## 设计原则

- 环境选择与环境准备分开。每条 Attempt 只解析一个 Sandbox Case。
- Eval source 可以由作者声明,也可以由数据集 adapter 从原始 task package 派生。
- 准备动作按 Experiment sandbox、Eval、Agent 三个既有 owner 归位,不再建立通用 Environment contribution。
- 预装产物是优化。需要判断命中时,领域 helper 必须检查实际状态并在安装后复检。
- 作者看到的顺序就是执行顺序。没有真实需求时不引入依赖 DAG、资源锁与自动并行。
- build、start、setup、普通文件传输、Agent turn 与活 Sandbox 复用是不同动作。
- 逐题 Eval 保持自包含；生命周期机械动作由字段归属表达，不靠模块顶层登记副作用。

## 需求

1. Eval 自带 profile/source 时,当前 Provider 必须兑现它；Experiment fallback 不能静默替代题目环境。
2. Eval 不带 Environment 时,Experiment 的 Provider-native fallback 可以成为起点。
3. 外部 benchmark 的 task package 可以通过 adapter 批量迁移,不要求逐题复制环境声明。
4. Experiment sandbox setup 必须作用于最终选中的主 Sandbox,无论它来自 Eval source 还是 fallback。
5. EvalDef setup 必须作用于最终选中的主 Sandbox,无论 fallback 由哪个 Experiment 选择。
6. Agent 安装保持独立 owner,在 Environment 与题目准备完成后执行。
7. 现场无法组合时,Experiment 可以按 profile 提供完整预制 Case；Runner 不合并两个起点。
8. setup 的 identity、activity、失败 phase 与可验证 helper 的实际 facts 必须进入正确记录。
9. 普通作者只需理解 Environment、Provider 选择、运行中的 Sandbox 与三个有主 setup 层。
10. 起始文件与测试文件使用同一套普通 Sandbox API；相对 `send` 的顺序决定可见性，Runner 自动记录本地 transfer manifest。
11. 每题可以完整重复自己的定义，不要求用数据集 adapter 或共享 Eval 工厂消除重复。

## 不是本 doc 的目标

- 不定义通用 Requirement/Layer/Addon DSL。
- 不自动推导 setup 依赖、资源锁或并行调度。
- 不改变 `sandboxReuse` 的显式 opt-in、CaseKey 分组、workdir reset 与活状态边界；候选可以调整 setup 检查频次以保持 owner 顺序。
- 不定义外部实验状态的 checkpoint、后继和失败提交策略。
- 不重新定义 Agent runtime。
- 不重新定义多容器 case 的 ready、证据、清理与 retain/resume 义务。
- 不建立跨 Provider 的安装步骤 DSL。
