# PLAN-5:默认 case、条件基底与 Requirement 集合(推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

---

## 方案定位

### 简述

一次 Attempt 始终保留 Eval、Experiment 与 Agent 三份互不覆盖的 Requirement。
Eval 与 Experiment contribution 都携带 Requirement 集合,并且都可以提供一个 Base Case。
Agent Requirement 由 AgentProvisioner 持有,只在最终主 Sandbox 中执行 Ensure。

Base Case 是一条 Attempt 唯一选择的完整 Sandbox Case。
Requirement 通过 verify、缺失时 prepare 与 install、安装后复检的 Ensure 路径在该 Base 上收敛。
预制产物、受管 manifest 与 Base 来源都不能跳过真实 verify。

本方案对基底、Requirement 数量和不兼容时机作出三项独立裁决:

1. SandboxSpec 起点是普通默认 case,不代表 Experiment Requirement。
2. 只有与 Experiment Requirement 集合同点声明的 Base 才是条件基底。
3. contribution 携带 Requirement 集合;不兼容结果按声明期与运行期分层。

### 基底分两档

| 类型 | 声明位置 | 表达的事实 | 是否参与双 Base 冲突 |
|---|---|---|---|
| 默认 case | SandboxSpec 的 image、template、snapshot | 没有其它 Base 时从哪里创建普通 Sandbox | 否 |
| 条件基底 | Experiment contribution 的 `base` | 该完整 case 预期满足同点声明的实验 Requirement 集合 | 是 |

Eval 提供 Base 时,普通默认 case 让位。
Experiment 没有条件基底时,Eval Base 不与 SandboxSpec 起点冲突。
默认 case、条件基底、Eval Base 与融合 case 启动后都执行真实验证。

### Base Case 选择

| Eval Base | 条件基底 | 最终 Base Case |
|---|---|---|
| 无 | 无 | SandboxSpec 默认 case;没有时使用 Provider 中性 case |
| 有 | 无 | Eval Base |
| 无 | 有 | 条件基底 |
| 有 | 有 | 精确 profile 对应的融合 case;缺项时报配置错误 |

SandboxSpec 的 `environments` 表把 Eval profile 映射成预制 case。
该表项是 Eval Requirement 的预制实现,归 Eval Base。
它与 folder-local source 同属 Eval 一侧,不改变双 Base 判定。

融合 `cases` 表角色不同。
它只在 Eval Base 与条件基底同时存在时选择一个已融合双方条件的完整 case。
表项不替代两份 Requirement,启动后仍分别 verify。

### Requirement 集合

一次 Experiment 可以分别声明证书、内部 registry、运行时、模型和工具。
每个 Requirement 保留自己的 name、identity、依赖、资源、实际检查与错误归属。
集合参与哈希前按稳定成员键排序,数组位置不表达安装顺序。

条件基底与 Requirement 集合同点声明。
这表示该 Base 预期满足集合中每个成员,但任何成员 verify 未命中时仍要现场 Ensure 或明确判为不兼容。

### 不兼容判定分两层

- **声明期**:重复键、依赖环、profile 查找失败、Provider 缺 source 支持、双 Base 缺融合表项。
  可穷举的缺失在创建任何 Sandbox 前一次报告。
- **运行期**:verify 依赖真实 Sandbox 状态。
  初始检查未命中且没有 install,或目标 Sandbox 缺安装能力时,在 Agent 开始前判为不兼容。

运行期不兼容产生零 Agent turn。
prepare、上传、install 或复检承诺可以执行却失败时,Attempt 记为 `errored`,不与合法但无法收敛的组合混为一种结果。

### Ensure 调度

Eval 与 Experiment 的 Requirement 集合在 `sandbox.setup` 阶段组成依赖与资源图。
Runner 先验证所有成员,只为未命中且可安装的成员执行准备与安装。
每个成员安装后复检,全图结束后再验证整个 Eval 与 Experiment 集合。

AgentProvisioner 随后在 `agent.setup` 执行自己的检查、准备、安装与复检。
外部状态载入完成后,Runner 运行覆盖三份 Requirement 的最终屏障,然后才允许 Agent 开始做题。

`dependsOn` 表达语义依赖,`resources` 表达互斥。
未知资源使用保守 `sandbox-mutation` 锁。
只有资源互不冲突且依赖已经满足的成员可以并行。

### 方案收益

- 普通默认起点不制造双 Base 冲突,C10 的异构批次可以使用一个 SandboxSpec。
- 条件基底只在作者明确把起点与实验条件绑定时出现,冲突语义来自声明而不是字段位置。
- Requirement 集合为多项实验条件保留成员级身份、依赖、资源、事实与诊断。
- 声明期与运行期不兼容各自在最早可判时机产生明确结果。
- Sandbox Case 与 AgentProvisioner 保留领域义务,只共享安装调度设施。
- 两道全组验证屏障可以发现后装 Requirement、Agent 安装或状态载入造成的破坏。

### Cases 覆盖

| Case | 结果 | 本方案的路径 |
|---|---|---|
| [C1](../CASES.md#c1评估环境较重) | 覆盖 | Eval contribution 提供完整 Base 与题目 Requirement 集合 |
| [C2](../CASES.md#c2实验环境较重) | 覆盖 | Experiment Requirement 集合在每个全新 Sandbox 中验证并按缺项 Ensure |
| [C3](../CASES.md#c3评估与实验环境都较重) | 覆盖 | 选择 Eval Base,实验成员按身份和目标平台 single-flight 准备离线 payload |
| [C4](../CASES.md#c4组合多个条件) | 覆盖 | 每项条件是独立成员,依赖与资源进入调度图,结束后全组复检 |
| [C5](../CASES.md#c5预装稳定条件) | 覆盖 | 预装只使成员 verify 命中,Base 与解析身份仍进入 fingerprint |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | 覆盖 | 状态 load/save 保持独立,位于安装条件就位之后 |
| [C7](../CASES.md#c7复用-sandbox-活状态) | 覆盖 | 复用窗口保留独立身份,每条 Attempt 仍验证全部成员 |
| [C8](../CASES.md#c8experiment-提供条件基底) | 覆盖 | 条件基底创建 Sandbox,Eval 集合通过 verify 或 Ensure 收敛 |
| [C9](../CASES.md#c9双方都有不可叠加基底) | 覆盖 | 双 Base 必须命中精确 profile 融合 case |
| [C10](../CASES.md#c10混合批次) | 覆盖 | 有 Eval Base 时默认 case 让位,无 Base 时使用条件基底或默认 case |

C8、C9 与 C10 的完整调用分别见[Experiment 条件基底](use-case/Experiment条件基底.md)、[融合双方基底](use-case/融合双方基底.md)与[混合批次](use-case/混合批次.md)。

### 相比 [PLAN-4](../PLAN-4/README.md)

两份方案都使用三份 Requirement、唯一 Base Case、实际 verify、Ensure 调度和显式融合 case。
本方案不借用另一份方案的规范;两者的差异只有以下三项:

- SandboxSpec 起点从 Experiment Base 改为普通默认 case。
- 单数 `requirement` 槽位改为 `requirements` 集合。
- 不兼容判定明确分成声明期与运行期。

### 落地路线

1. 从 Sandbox Case 提取只读 Requirement verifier,保留 BuildKey、CaseKey 与资源组。
2. 定稿 Eval 与 Experiment 的 Requirement 集合 helper,不要求普通作者实现底层接口。
3. 实现默认 case、Eval Base、条件基底与融合 case 的固定选择算法。
4. 实现声明期全量诊断与运行期不兼容结果。
5. 实现成员级调度、single-flight、逐成员复检、全组复检与最终验证屏障。
6. 接入 AgentProvisioner 的准备协调和资源声明,但不改变 Adapter 领域协议。
7. 落盘声明身份、解析身份、实际事实、活动、耗时与复用窗口信息。
