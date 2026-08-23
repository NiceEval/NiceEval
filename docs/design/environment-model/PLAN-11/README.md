# PLAN-11:默认 case、条件基底与 Requirement 集合(不推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [PLAN-4](../PLAN-4/README.md) · [PLAN-6](../PLAN-6/README.md) · [PLAN-7](../PLAN-7/README.md) · [PLAN-8](../PLAN-8/README.md) · [PLAN-9](../PLAN-9/README.md) · [PLAN-10](../PLAN-10/README.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 方案定位

### 简述

一次 Attempt 始终保留 Eval、Experiment 与 Agent 三份互不替代的 Requirement。
Eval 与 Experiment contribution 都携带 Requirement 集合,并且都可以提供一个 Base Case。
Agent 由 AgentProvisioner 与 AgentRuntimeLifecycle 两段持有,只在最终主 Sandbox 中执行 Ensure,不贡献 Base。

Base Case 是一条 Attempt 唯一选择的完整 Sandbox 实例。
Requirement 通过 verify、缺失时 prepare 与 install、安装后复检的 Ensure 路径在该 Base 上收敛。
预制构建输出、受管 manifest 与 Base 声明位置都不能跳过真实 verify。

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

### Lifecycle 与 Ensure 调度

三方声明、Base/template 选择、build/start、安装、Fixture 与 Sandbox 复用的完整次数表见 [Lifecycle](lifecycle.md)。

Eval 与 Experiment 的 Requirement 集合每 Attempt 组成依赖与资源图。
Runner 先验证所有成员,只为未命中且可安装的成员执行准备与安装。
每个成员安装后复检,全图结束后再验证整个 Eval 与 Experiment 集合。

AgentProvisioner 随后检查、准备、安装与复检 Agent CLI。
ExperimentStateLifecycle 与早期 SandboxSpec setup 分开,在 Agent CLI 就位后 load。
Agent runtime 再逐 Attempt 写鉴权、配置与扩展,并以自己的 identity 和 verify 进入最终屏障。

状态按显式 `saveOn` 策略在逐 Attempt 或复用周期收尾时 save;checkpoint identity、digest、后继规则与结果进入运行 Record。
复用没有逐 Attempt 回滚,所以必须选 `after-load`;`attempt-succeeded` 只用于 fresh。
turn 前 Fixture 与 turn 后隐藏 verifier 也保持不同可见性;后者用受管 cleanup 接管 workdir 外资源。

`sandboxReuse` 只复用同一 Experiment、profile 与 CaseKey 的活 Sandbox。
Eval、Experiment 与 Agent 三方检查仍逐 Attempt 执行。

### 方案收益

- 普通默认起点不制造双 Base 冲突,C10 的异构批次可以使用一个 SandboxSpec。
- 条件基底只在作者明确把起点与实验条件绑定时出现,冲突语义来自声明而不是字段位置。
- Requirement 集合为多项实验条件保留成员级身份、依赖、资源、事实与诊断。
- 声明期与运行期不兼容各自在最早可判时机产生明确结果。
- Sandbox 实例与 AgentProvisioner 保留领域义务,只共享安装调度设施。
- 两道全组验证屏障可以发现后装 Requirement、Agent 安装、runtime setup 或状态载入造成的破坏。
- 独立 state lifecycle 让 MemoryBench 的 load/save 与复用周期有可执行相位、身份和失败语义。
- turn 后 verifier 阶段保留 Terminal-Bench 的隐藏 official tests,并在复用前强制 cleanup,不把判分材料烘进 Base 或 turn 前 Fixture。

### Cases 范围

| Case | 结果 | 本方案的路径 |
|---|---|---|
| [C1](../CASES.md#c1评估-sandbox-较重) | 涵盖 | Eval contribution 提供完整 Base 与题目 Requirement 集合 |
| [C2](../CASES.md#c2实验-sandbox-较重) | 涵盖 | Experiment Requirement 集合在每个全新 Sandbox 中验证并按缺项 Ensure |
| [C3](../CASES.md#c3评估与实验-sandbox-都较重) | 涵盖 | 选择 Eval Base,实验成员按身份和目标平台 single-flight 准备离线 payload |
| [C4](../CASES.md#c4组合多个条件) | 涵盖 | 每项条件是独立成员,依赖与资源进入调度图,结束后全组复检 |
| [C5](../CASES.md#c5预装稳定条件) | 涵盖 | 预装只使成员 verify 命中,Base 与归一身份仍进入 fingerprint |
| [C6](../CASES.md#c6新-sandbox-载入外部状态) | 涵盖 | 独立 state lifecycle 在 Agent CLI 就位后 load/save,不借用早期 SandboxSpec Hook |
| [C7](../CASES.md#c7复用-sandbox-活状态) | 涵盖 | 复用周期保留独立身份,每条 Attempt 仍验证全部成员 |
| [C8](../CASES.md#c8experiment-template-主导起点) | 涵盖 | 条件基底创建 Sandbox,Eval 集合通过 verify 或 Ensure 收敛 |
| [C9](../CASES.md#c9eval-template-需要融合条件) | 涵盖 | 双 Base 必须命中精确 profile 融合 case |
| [C10](../CASES.md#c10混合批次) | 涵盖 | 有 Eval Base 时默认 case 让位,无 Base 时使用条件基底或默认 case |

C8、C9 与 C10 的完整调用分别见[Experiment 条件基底](use-case/Experiment条件基底.md)、[融合双方基底](use-case/融合双方基底.md)与[混合批次](use-case/混合批次.md)。

### 相比 [PLAN-4](../PLAN-4/README.md)

两份方案都使用三份 Requirement、唯一 Base Case、实际 verify、Ensure 调度和显式融合 case。
本方案不借用另一份方案的规范。
Base 与 Requirement 模型有前三项差异;后三项补齐真实仓库要求的生命周期:

- SandboxSpec 起点从 Experiment Base 改为普通默认 case。
- 单数 `requirement` 槽位改为 `requirements` 集合。
- 不兼容判定明确分成声明期与运行期。
- 外部状态使用有 identity、load/save activity 与失败语义的独立 lifecycle,不借用早期 SandboxSpec setup。
- Agent 安装与 runtime setup 分段建模;runtime identity、verify 与 teardown 进入最终屏障。
- turn 后隐藏 verifier 使用受管挂载 / cleanup,复用周期不会把判分材料带给下一题。

### 落地路线

1. 从 Sandbox 实例提取只读 Requirement verifier,保留全部 BuildKey、locator、CaseKey 与主 Sandbox 及伴随资源。
2. 定稿 Eval 与 Experiment 的 Requirement 集合构造函数,不要求普通作者实现底层接口。
3. 实现默认 case、Eval Base、条件基底与融合 case 的固定选择算法。
4. 实现声明期全量诊断与运行期不兼容结果。
5. 实现成员级调度、single-flight、逐成员复检、全组复检与最终验证屏障。
6. 接入 AgentProvisioner,并为 Agent runtime 增加 identity、verify 与成对 teardown。
7. 增加独立 Experiment state lifecycle,定义 fresh / reuse cadence、轮换、取消与失败语义。
8. 增加受管隐藏 verifier Fixture,让资源准备与 workdir 外 cleanup 成对。
9. 落盘声明身份、归一身份、实际事实、活动、耗时、state checkpoint 与复用周期信息。
