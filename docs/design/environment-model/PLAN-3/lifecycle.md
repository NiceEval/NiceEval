# PLAN-3 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇把 PLAN-3 的运行语义摊成一条时间线,只回答四个问题:

1. Eval、Experiment、Agent 与 SandboxSpec 分别拥有哪一段。
2. template、Compose 与其它起点同时出现时,哪一份负责 build 和 start。
3. Addon 安装、状态 Hook、Fixture 与 AgentProvisioner 按什么顺序执行。
4. `sandboxReuse` 打开后,哪些步骤每窗口一次,哪些步骤仍然每 Attempt 执行。

类型与错误语义仍以 [Library](library.md) 和 [Architecture](architecture.md) 为准。
本篇不为方案补造 Experiment Base、Eval Addon 或新的状态协议。

## 图例

```text
D       SandboxSpec 的普通默认 Case
E[p]    environment profile 为 p 的完整 Eval Case
P[p]    environments[p] 提供的 E[p] 预制实现
X[]     Experiment Addon 集合
A       AgentProvisioner
S       Sandbox setup/teardown 状态 Hook
W       Eval Fixture 与 workdir 准备

====>   被选为唯一 Sandbox Case,负责 build/start
....>   不负责启动,在已启动主 Sandbox 中检查或安装
  ×     本方案没有这种声明
```

template 只是 `D` 或 `P[p]` 的一种物理形态。
Dockerfile、Compose、image 与 snapshot 使用同一套 Case 选择规则。

PLAN-3 没有 Experiment Base 符号。
Experiment 只能贡献 `X[]`,不能让一个 template 以 Experiment owner 参与选择。

## Owner 模型

| Owner | 可以贡献 Base | 安装、状态与运行职责 |
|---|---|---|
| Eval | 完整 `E[p]` | Case source、ready 与伴随资源归 Case;`W` 准备本 Attempt 的任务工作区 |
| Experiment | 不可以 | `X[]` 描述主 Sandbox 中应成立的实验工具;实验状态通过 `S` 载入和回存 |
| Agent | 不可以 | `A` 检查、准备并安装 Agent CLI、配置与启动条件 |
| SandboxSpec | `D` 与 `P[p]` | 选择 Provider、普通默认起点,或替换某个 Eval Case 的预制实现 |

`P[p]` 虽然写在 SandboxSpec 中,语义上仍是 `E[p]` 的预制实现。
它不成为 Experiment Base,也不表示实验条件已经预装。

Agent CLI 或 Addon 可以碰巧预装在 `D`、`E[p]` 或 `P[p]` 中。
预装只会让对应检查命中,不会改变 owner。

Eval 没有独立的可移植 Ensure。
题目条件只能随完整 `E[p]` 出现,或由 `W` 作为 Attempt Fixture 准备。

## Base 与 template 选择

```text
resolve Eval Case:

  matching P[p]
       |
       v
  P[p] ====> selected

  no P[p] + folder-local source
       |
       v
  materialize E[p] ====> selected

  no Eval environment + D
       |
       v
  D ====> selected

  no Eval environment + no D
       |
       v
  Provider neutral Case ====> selected
```

优先级可以压成一行:

```text
P[p] > materialized E[p] > D > Provider neutral Case
```

`D` 只在 Eval 没有 environment 时使用。
它不会与 `E[p]` 冲突,也没有融合表。

`X[]`、`A`、`S` 与 `W` 都不参与 Base 选择。
它们只能在唯一 Case start 并 ready 后工作。

## Build、start、install 与 Fixture

| 阶段 | Owner | fresh Attempt | reuse window |
|---|---|---|---|
| 解析 source、profile 与 CaseKey | Eval + SandboxSpec | 每个 Eval 规划一次 | 每个 Eval 规划一次 |
| build 或定位起点产物 | 所选 Case | 按 BuildKey 协调和复用 | 窗口打开前一次 |
| start、services ready | 所选 Case | 每 Attempt 一次 | 每窗口一次 |
| Addon check/install/recheck | Experiment | 每 Attempt 一次 | 每 Attempt 一次 |
| `S.load` / `S.save` | Experiment 状态 | 每 Sandbox 一次 | 窗口打开、关闭各一次 |
| workdir baseline 与 `W` | Eval | 每 Attempt 一次 | 每 Attempt 重建 |
| AgentProvisioner Ensure | Agent | 每 Attempt 一次 | 每 Attempt 一次 |
| Case finalizer | 所选 Case | 每 Attempt 一次 | 每窗口一次 |

build 与 start 是两件事。
相同 BuildKey 可以复用不可变产物,不同运行实例仍有不同 CaseKey 和清理责任。

Addon 安装不是 build。
它发生在已经 ready 的主 Sandbox 中,并且每条 Attempt 都从真实 `check` 开始。

Fixture 也不是安装。
`W` 可以写 workdir 并参与 reset 与 diff 归因;Addon、Agent CLI 和跨 Attempt 状态不能依赖 Fixture 冒充。

## 一条 fresh Attempt

```text
声明与规划
  -> 选择 P[p] / E[p] / D / Provider neutral Case
  -> build or locate selected artifact
  -> start full Sandbox Case
  -> wait services/resources ready
  -> X[] check
  -> prepare/install/recheck misses
  -> X[] full-group recheck
  -> S.load
  -> establish workdir baseline
  -> W: Eval setup and Fixture
  -> A: check/prepare/install/recheck
  -> recheck X[] after state and Agent mutations
  -> Agent turn and scoring
  -> Eval and Agent paired teardown
  -> S.save
  -> Case finalizer and Sandbox stop
```

`S.load` 可以使用已经收敛的 Addon,因为 Addon 位于它之前。
但 `S.load` 早于 AgentProvisioner。

因此需要 Agent CLI 才能恢复状态的 C6 无法满足精确顺序。
把 Agent CLI 重复包装成 Addon 会丢失 AgentProvisioner 的 staged payload、安装模式与专有事实,不是本方案允许的修补。

Agent Ensure 后的屏障只重新检查 `X[]`。
完整 Eval Case 的 ready 与服务责任仍留在 Case 生命周期,不会被转换成可移植 Eval Requirement。

## `sandboxReuse` 生命周期

```text
window open
  -> select/build/start one Case
  -> first Attempt:
       X[] check/install/full recheck
       -> S.load once
       -> baseline + W
       -> A Ensure
       -> X[] cross-owner barrier
       -> Agent turn

later Attempt
  -> ensureLifetime
  -> reset workdir to the window baseline
  -> X[] check/install/full recheck again
  -> keep live S; do not load again
  -> rebuild W
  -> A Ensure again
  -> X[] cross-owner barrier again
  -> Agent turn

window close
  -> finish paired Eval and Agent teardown
  -> S.save once
  -> Case finalizer and Sandbox stop
```

一个窗口只承接相同 Experiment 与相同 CaseKey 的 Attempt。
不同 `P[p]`、`E[p]` 或 `D` 不共享运行实例。

复用的是 Case 实例与 workdir 外的活状态,不是前一条 Attempt 的检查结论。
Addon 和 AgentProvisioner 每 Attempt 都重新检查;前一次安装通常只让下一次检查命中。

`$HOME`、系统目录、后台进程与外部状态可以跨 reset 存续。
依赖单份有序状态时,Experiment 还要把并发限制为一条窗口。

## C1-C10 的 Base 选择

| Case | PLAN-3 选中的 Case/template | start 后发生什么 | 结论 |
|---|---|---|---|
| C1 评估环境较重 | `P[p]` 或 materialized `E[p]`;`D` 让位 | Case ready;`X[]` 与 `A` 在主 Sandbox 中收敛 | 覆盖 |
| C2 实验环境较重 | 无 Eval environment 时选 `D` 或中性 Case | 每条 fresh Attempt 检查并安装 `X[]` | 覆盖 |
| C3 双方都较重 | `E[p]`;Experiment 不能另带 Base | 离线 payload 由 Addon prepare,再上传、安装和复检 | 覆盖可安装实验条件 |
| C4 组合多个条件 | Base 沿 C1-C3;数量不改变选择 | `X[]` 按依赖与资源图调度 | 覆盖 |
| C5 预装稳定条件 | Eval 预装用 `P[p]`;普通预装可在 `D` | Addon 与 Agent 仍真实检查,命中时跳过安装 | 覆盖 |
| C6 新 Sandbox 外部状态 | Base 沿 C1-C5 | `X[] -> S.load -> W -> A`;收尾 `S.save` | 部分覆盖,状态早于 Agent |
| C7 复用活状态 | 每窗口选择一个 CaseKey | `S` 每窗口 load/save;`X[]` 与 `A` 每 Attempt 检查 | 覆盖 |
| C8 Experiment 条件基底 | 只能把 template 写成普通 `D` | 无 Eval Base 时可以启动,但没有 Experiment Base 身份 | 不覆盖 |
| C9 双方不可叠加 Base | 只有 `E[p]`;Experiment Base 为 `×` | 只能尝试 Addon Ensure,不能声明精确融合 Case | 不覆盖 |
| C10 混合批次 | 有 Eval Case 的选 `E[p]`;其余选 `D` | `X[]` 同样应用于两组 | 只覆盖无条件基底分支 |

### C8 与 C9 的能力边界

```text
PLAN-3 可以表达:

Eval E[p] ==============================> selected/start
Experiment X[] ..........................> Ensure in E[p]
Agent A .................................> Ensure in E[p]

PLAN-3 不能表达:

Experiment conditional template X ======> selected/start      ×
Eval E[p] + Experiment X -> fused F[p] ==> selected/start      ×
```

把条件 template 填进 `D` 只会得到普通默认 Case。
当某个 Eval 带 `E[p]` 时,`D` 必须让位,所以这份 template 无法承担 C9 的实验条件。
