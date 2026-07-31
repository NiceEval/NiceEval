# PLAN-4:Requirement、Base Case 与 Ensure(不推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [PLAN-5](../PLAN-5/README.md) · [Lifecycle](lifecycle.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 方案定位

### 简述

一次 Attempt 始终保留 Eval、Experiment 与 Agent 三份互不覆盖的 Requirement。
Eval 与 Experiment 各贡献一个 Requirement,并且都可以同时贡献一个 Base Case。
Agent Requirement 由 AgentProvisioner 持有,只在最终主 Sandbox 中执行 Ensure,不参与 Base Case 选择。

Base Case 是一条 Attempt 唯一的完整 Sandbox Case。
它可以来自 image、template、snapshot、Dockerfile 或 Compose,但 Runner 不在运行时合并两个 Base Case。
Requirement 通过 verify、缺失时 prepare 与 install、安装后复检的 Ensure 路径在选定 Base Case 上收敛。

本方案把 SandboxSpec 上显式配置的起点产物解释成 Experiment Base。
这个解释可以表达 C8 与 C9,但会让 C10 的普通默认起点参与双 Base 冲突。

### 四种普通组合

| Eval Base | Experiment Base | 最终 Base Case | 后续动作 |
|---|---|---|---|
| 无 | 无 | Provider 中性 case | Eval、Experiment 与 Agent 分别 Ensure |
| 有 | 无 | Eval Base | Eval 仍 verify;Experiment 与 Agent Ensure |
| 无 | 有 | Experiment Base | Experiment 仍 verify;Eval 与 Agent Ensure |
| 有 | 有 | 精确 profile 对应的融合 case | 缺融合 case 时启动期报配置错误 |

有 Base 的 Requirement 仍然执行真实 verify。
Base 只表示该起点预期满足 Requirement,不表示浮动 tag、错误构建或后续修改可以绕过验证。

`sandbox: e2bSandbox({ template })` 这类显式起点在本方案中构成 Experiment Base。
Provider 没有显式起点时提供的中性 case 不构成任何一方的 Base。

### Ensure 调度

Eval 与 Experiment Requirement 在 `sandbox.setup` 阶段进入同一依赖与资源图。
调度器先验证全部节点,只为未命中且可安装的节点准备 payload 并执行安装。
每次安装后复检该节点,整组安装完成后再验证全部 Eval 与 Experiment Requirement。

AgentProvisioner 随后在 `agent.setup` 阶段执行自己的检查、准备、安装与复检。
外部状态载入完成后,Runner 再执行覆盖三份 Requirement 的最终屏障,然后才允许 Agent 开始做题。
这道屏障负责发现 Agent 安装或状态载入破坏的先前条件。

数组位置不表达顺序。
`dependsOn` 表达语义依赖,`resources` 表达安装互斥。
未知资源使用保守的 `sandbox-mutation` 锁,明确互不冲突且依赖满足的节点才可以并行。

### 方案收益

- Requirement 与兑现方式分开。任一侧可以提供 Base,也可以在另一侧的 Base 上 Ensure。
- 双 Base 没有隐式优先级。融合 case 显式承担两份完整起点的组合成本。
- 实际 verify 是必经路径。预制产物与受管 manifest 都不能单独证明状态满足。
- Sandbox Case 与 AgentProvisioner 保留各自完整职责,只共享准备协调与资源互斥设施。
- 声明身份、所选 CaseKey、目标平台与 payload digest 分别进入 configHash 或逐 Eval fingerprint。

### 已知限制

- Eval 与 Experiment 的 contribution 各只有一个 `requirement` 槽位。
  多项实验条件必须压成一个复合 Requirement,独立身份、依赖、资源与事实无法分别保持为一等成员。
- SandboxSpec 的显式起点被解释为 Experiment Base。
  C10 中普通默认起点与 Eval Base 同时出现时也要提供融合 case,即使起点并不代表任何实验条件。
- Eval verifier 需要读取完整 Sandbox Case 的 ready、services、能力与身份事实。
  这个协议比只检查主 Sandbox 的工具 Addon 更抽象。

### Cases 覆盖

| Case | 结果 | 本方案的路径 |
|---|---|---|
| [C1](../CASES.md#c1评估环境较重) | 覆盖 | Eval contribution 提供完整 Base 与题目 Requirement,BuildKey 与 CaseKey 继续归 Sandbox Case |
| [C2](../CASES.md#c2实验环境较重) | 覆盖 | Experiment Requirement 在每个全新 Sandbox 中 verify,缺失时 Ensure |
| [C3](../CASES.md#c3评估与实验环境都较重) | 覆盖 | 选择 Eval Base,Experiment prepare 按身份和目标平台 single-flight 后现场安装 |
| [C4](../CASES.md#c4组合多个条件) | 部分覆盖 | 复合 Requirement 可以完成检查和安装,但多项条件没有独立 contribution 槽位 |
| [C5](../CASES.md#c5预装稳定条件) | 覆盖 | 预装只让 verify 命中,更换起点仍改变所选 Sandbox Case 身份 |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | 覆盖 | 外部状态继续使用独立 Hook,不并入 Requirement |
| [C7](../CASES.md#c7复用-sandbox-活状态) | 覆盖 | 复用窗口保留独立身份,每条 Attempt 仍执行三份验证 |
| [C8](../CASES.md#c8experiment-提供条件基底) | 覆盖 | SandboxSpec 显式起点作为 Experiment Base,Eval 通过 verify 或 Ensure 收敛 |
| [C9](../CASES.md#c9双方都有不可叠加基底) | 覆盖 | 双 Base 必须命中精确 profile 的融合 case |
| [C10](../CASES.md#c10混合批次) | **不覆盖** | 普通显式起点也算 Experiment Base,自带 Base 的 Eval 被迫配置融合 case |

C8、C9 与 C10 的完整调用分别见[实验起点](use-case/实验起点.md)、[融合双方基底](use-case/融合双方基底.md)与[混合批次缺口](use-case/混合批次缺口.md)。

### 和其它方案的关系

- **vs [PLAN-3](../PLAN-3/README.md)**:本方案允许 Experiment 提供 Base,也允许 Eval 只提供可移植 Ensure。
- **vs [PLAN-5](../PLAN-5/README.md)**:PLAN-5 把普通默认 case 与条件基底分开,并把单数 Requirement 扩成集合。

### 落地路线

1. 从 Sandbox Case 提取只读 Requirement verifier,保留 BuildKey、CaseKey 与资源组。
2. 定稿 Eval 与 Experiment contribution helper,不要求普通作者实现底层接口。
3. 实现四种组合、精确 profile 融合表与双 Base 缺项诊断。
4. 实现 Requirement 调度、逐节点复检、全组复检与跨 Agent 的最终验证屏障。
5. 接入 AgentProvisioner 的准备协调和资源声明,但不改变 Adapter 领域协议。
6. 落盘声明身份、解析身份、实际事实、活动、耗时与不兼容诊断。
