**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [PLAN-10](PLAN-10/README.md) · [DECISION](DECISION.md)

---

## 目的

决定 Eval 与 Experiment 的 Sandbox 声明怎样为每个实际配对选出唯一起点、形成最终 Sandbox，并与 Agent 准备组成有序执行链。
范围覆盖起点解析、准备动作归属、真实检查、身份与错误记录。

跨 Attempt 状态复用见 [Experiment Speed](../experiment-speed/README.md),多容器运行义务见 [多容器环境](../multi-container-environments/README.md)。

## 设计原则

- template 选择与 Sandbox 准备分开。每条 Attempt 只解析一个 Sandbox Case。
- Eval 的 Sandbox 声明可以由作者编写，也可以由数据集 adapter 从原始 task package 派生。
- 准备动作按 Experiment、Eval、Agent 三个既有 owner 归位,不再建立通用 Environment contribution。
- 预装产物是优化。需要判断命中时,领域 helper 必须检查实际状态并在安装后复检。
- 作者看到的顺序就是执行顺序。没有真实需求时不引入依赖 DAG、资源锁与自动并行。
- build、start、setup、普通文件传输、Agent turn 与活 Sandbox 复用是不同动作。
- 逐题 Eval 保持自包含；生命周期机械动作由字段归属表达，不靠模块顶层登记副作用。

## 需求

1. 对 Sandbox Agent，每个实际 Eval × Experiment pair 恰好一方声明起点；两方都有或都没有都必须在创建资源前聚合报错。不同 pair 可以使用不同起点。
2. 带起点的声明同时选定 Provider，可以来自 Eval 或 Experiment；不存在游离的 Provider 配置或 implicit default。
3. 外部 benchmark 的 task package 可以通过 adapter 批量迁移,不要求逐题复制环境声明。
4. Experiment 的准备 command 必须作用于最终选中的主 Sandbox，无论起点来自哪一方。
5. Eval 的准备 command 必须作用于最终选中的主 Sandbox，无论起点 owner 是哪一方。
6. Agent 安装保持独立 owner,在 template 对应 Case 与题目准备完成后执行。
7. 现场无法组合时,作者必须让恰好一侧改用已融合条件的完整 template，或用 selector 排除；Runner 不合并两个起点。
8. 准备声明的 identity、activity、失败 phase 与可验证 helper 的实际 facts 必须进入正确记录。
9. 普通作者只需理解一种 Eval / Experiment Sandbox 声明、具体起点 factory、运行中的 Sandbox 与三个 owner。
10. 起始文件与测试文件使用同一套普通 Sandbox API；相对 `send` 的顺序决定可见性，Runner 自动记录本地 transfer manifest。
11. 每题可以完整重复自己的定义，不要求用数据集 adapter 或共享 Eval 工厂消除重复。
12. 候选若暴露非 Attempt 频次，该 command 在类型上不能读取 Attempt；逐 Attempt command 必须拿到 Attempt。任何准备 command 都不能停止或替换主 Sandbox。
13. 准备 command 的非零退出在当前 phase 默认失败；无法证明动态输入 identity 的 callback 不得命中跨 Run carry，也不能成为跳过准备或错误复用窗口的依据。

## 不是本 doc 的目标

- 不定义跨领域通用 Requirement/Layer/Addon DSL；候选可以为 Sandbox 域定义单一作者声明。
- 不自动推导 setup 依赖、资源锁或并行调度。
- 不改变 `sandboxReuse` 的显式 opt-in、CaseKey 分组、workdir reset 与活状态边界；候选必须明确准备命令在复用时的检查频次。
- 不定义外部实验状态的 checkpoint、后继和失败提交策略。
- 不重新定义 Agent runtime。
- 不重新定义多容器 case 的 ready、证据、清理与 retain/resume 义务。
- 不建立跨 Provider 的安装步骤 DSL。
