# PLAN-3 用例守护

契约单源在 [Library](../library.md) 与 [Architecture](../architecture.md)。
本页只把根 [CASES](../../CASES.md) 的输入逐项代入 `Sandbox Case`、Experiment Addon 与 AgentProvisioner。

状态含义：

- **支持**：本方案有完整声明入口、收敛路径和失败语义。
- **部分**：主要路径可表达，但至少一条验收条件没有契约保证。
- **不支持**：缺少对应领域对象，不能靠内部实现补出公开语义。

## 守护矩阵

| Case | 状态 | 声明入口 | Base | 收敛路径 | 失败或缺口 |
|---|---|---|---|---|---|
| [C1 评估 Sandbox 较重](../../CASES.md#c1评估-sandbox-较重) | 部分 | `eval.environment` + SandboxSpec | Eval `Sandbox Case` | AgentProvisioner 在主 Sandbox Ensure | Agent 后不重验完整 Eval Case |
| [C2 实验 Sandbox 较重](../../CASES.md#c2实验-sandbox-较重) | 部分 | 普通 SandboxSpec + `experiment.addons` | Provider 默认 Case | Addon check → install → recheck | 最后只重验 Addon,不是三方屏障 |
| [C3 两边都较重](../../CASES.md#c3评估与实验-sandbox-都较重) | 部分 | `eval.environment` + `experiment.addons` | Eval `Sandbox Case` | miss 后按平台 prepare、安装和全组复检 | Agent 后不重验 Eval Case |
| [C4 组合多个条件](../../CASES.md#c4组合多个条件) | 部分 | 多个 Addon 的 `dependsOn` + `resources` | 既有 Case | DAG、资源互斥、立即复检与全组复检 | Addon 图完整,但缺三方最终屏障 |
| [C5 预装稳定条件](../../CASES.md#c5预装稳定条件) | 部分 | 预制 Case + 保留 Addon 与 AgentProvisioner | `environments` 或普通预制 Case | 每 Attempt 真实检查;命中即跳过安装 | Agent 后不重验完整 Eval Case |
| [C6 新 Sandbox 载入外部状态](../../CASES.md#c6新-sandbox-载入外部状态) | 部分 | Sandbox `.setup()` / `.teardown()` + `maxConcurrency: 1` | 每 Attempt 新 Case | Addon 后载入，销毁前回存 | 状态 Hook 早于 Agent Ensure，不能保证用 Agent CLI 载入状态 |
| [C7 复用 Sandbox 活状态](../../CASES.md#c7复用-sandbox-活状态) | 部分 | C6 入口 + `sandboxReuse: true` | 每 CaseKey 复用周期一个 Case | 每 Attempt 重查 Addon、Agent 与 Addon 屏障 | 不因复用跳过检查,但缺三方最终屏障 |
| [C8 Experiment 提供条件基底](../../CASES.md#c8experiment-提供条件基底) | 不支持 | 没有 Experiment Base 与 Eval Addon 入口 | 只能是默认 Case | 只能安装 Experiment Addon | Eval 条件无法在 Experiment Base 上验证或补齐 |
| [C9 双方都有不可叠加基底](../../CASES.md#c9双方都有不可叠加基底) | 不支持 | 没有条件基底与融合 `cases` 表 | 只能选择 Eval Case | Experiment 只能贡献 Addon | 无法声明第二份 Base，也无法分别验证双方要求 |
| [C10 混合批次](../../CASES.md#c10混合批次) | 部分 | 普通默认 Case + Eval environments | 有 environment 用 Eval Case，其余用默认 Case | Experiment Addon 对两类 Case 都收敛 | 普通默认起点正确让位，但条件基底与融合分支不存在 |

## 代表性路径

### C3：两条变化轴不展开预构建矩阵

每道 Eval 的 Dockerfile 或 Compose 只改变 `Sandbox Case`。
Experiment 的工具只改变 Addon identity；Agent 版本只改变 AgentProvisioner identity。

同一个 Case 可以运行多组 Addon 与 Agent 条件，不要求发布“题目 Case × Experiment 工具 × Agent”的预构建矩阵。
故意断网时，Addon 在真实 check miss 后用宿主侧 `prepare` 按目标平台准备 payload，再经主 Sandbox 文件 API 安装。

### C4：最后一次安装之后仍要验证全组

证书、registry、运行时和工具用 `dependsOn` 表达语义先后，用 `resources` 表达共享写入面。
调度器只并行依赖已满足且资源不冲突的节点。

每项安装后立即复检只能证明当时正确。
全部安装完成后的全组复检负责发现后安装项破坏先安装项。
Agent Ensure 后再次检查 Addon,可以发现 Agent 对实验工具的破坏,但不会重验完整 Eval Case 或 Agent 自身。

### C10：普通默认 Case 不是 Experiment 条件基底

SandboxSpec 普通默认 Case 只服务没有 environment 的 Eval。
自带 folder-local source 或 profile 的 Eval 使用自己的 Case，不与普通默认 Case 冲突。

这使混合批次的普通分支可运行。
但本方案没有与 Experiment Requirement 绑定的条件基底，因此无法表达 C10 中需要融合 Case 的分支。
