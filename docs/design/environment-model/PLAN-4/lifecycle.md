# PLAN-4 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇把 PLAN-4 的运行语义摊成一条时间线,只回答四个问题:

1. Eval、Experiment、Agent 与 SandboxSpec 分别拥有哪一段。
2. template、Compose 与其它起点同时出现时,哪一份负责 build 和 start。
3. Requirement 安装、状态 Hook、Fixture 与 AgentProvisioner 按什么顺序执行。
4. `sandboxReuse` 打开后,哪些步骤每窗口一次,哪些步骤仍然每 Attempt 执行。

类型与错误语义仍以 [Library](library.md) 和 [Architecture](architecture.md) 为准。
本篇保留单数 Requirement 槽位,也保留显式 SandboxSpec 起点属于 Experiment Base 的解释。

## 图例

```text
N       Provider 中性 Case
E[p]    environment profile 为 p 的 Eval Base
X       Experiment Base
F[p]    已融合 E[p] 与 X 的完整 Case
R-E     单个 Eval Requirement
R-X     单个 Experiment Requirement
A       AgentProvisioner
S       外部状态 Hook
W       Eval Fixture 与 workdir 准备

====>   被选为唯一 Base Case,负责 build/start
....>   不负责启动,在已启动 Sandbox Case 中 verify/Ensure
  ×     本方案拒绝该组合
```

template、image 与 snapshot 只要显式写在 SandboxSpec 上,就会被归一成 `X`。
本方案没有独立的普通默认 Case 符号。

Dockerfile、Compose 与 Eval 的预制 profile Case 都属于 `E[p]`。
融合表项 `F[p]` 是完整 Case,不是 Runner 要运行时拼接的两个片段。

## Owner 模型

| Owner | 可以贡献 Base | 安装、状态与运行职责 |
|---|---|---|
| Eval | 一个 `E[p]` | 单个 `R-E` 描述题目事实;`W` 准备本 Attempt 的任务工作区 |
| Experiment | 一个 `X` 与 `F[p]` 表 | 单个 `R-X` 描述实验条件;`S` 在安装条件就位后载入和回存 |
| Agent | 不可以 | `A` 检查、准备并安装 Agent CLI、配置与启动条件 |
| SandboxSpec | 显式起点被算作 `X` | 选择 Provider;无显式起点时才提供不属于任何 owner 的 `N` |

Eval 与 Experiment 各只有一个 Requirement 槽位。
多个证书、registry、运行时与工具必须包进同一个复合 Requirement。

Agent CLI 可以预装在 `E[p]`、`X` 或 `F[p]` 中。
预装只让 AgentProvisioner 检查命中,不会让 Agent 参与 Base 竞争。

SandboxSpec 的显式 template 即使不承诺任何实验条件,仍被记成 `X`。
这条 owner 解释正是 C10 的冲突来源。

## Base 与 template 选择

```text
resolve E[p] = Eval contribution base or none

resolve X =
  Experiment contribution base
  or explicit SandboxSpec image/template/snapshot
  or none

E[p] + X  ───────────────> F[p] ====> selected/start
E[p] only ───────────────── E[p] ====> selected/start
X only    ─────────────────── X ====> selected/start
neither   ─────────────────── N ====> selected/start
```

Experiment contribution Base 与 SandboxSpec 显式起点占同一个槽位。
两者同时声明时不是融合关系,而是启动期重复配置错误。

`R-E`、`R-X`、`A`、`S` 与 `W` 都不参与选择。
Base 只决定从哪份完整 Case 启动,不能删除三份后续检查。

规划器先展开完整 Eval 矩阵。
任一 `E[p] + X` 缺少精确 `F[p]` 时,它在创建 Sandbox 前一次列出全部缺项。

## Build、start、install 与 Fixture

| 阶段 | Owner | fresh Attempt | reuse window |
|---|---|---|---|
| 解析两侧 Base 与融合表 | Eval + Experiment | 每个 Eval 规划一次 | 每个 Eval 规划一次 |
| build 或定位起点产物 | 所选 `N/E/X/F` | 按 BuildKey 协调和复用 | 窗口打开前一次 |
| start、services ready | 所选 Sandbox Case | 每 Attempt 一次 | 每窗口一次 |
| `R-E + R-X` verify/Ensure | Eval + Experiment | 每 Attempt 一次 | 每 Attempt 一次 |
| workdir baseline 与 `W` | Eval | 每 Attempt 一次 | 每 Attempt 重建 |
| AgentProvisioner Ensure | Agent | 每 Attempt 一次 | 每 Attempt 一次 |
| `S.load` / `S.save` | Experiment 状态 | 每 Attempt 各一次 | 窗口打开、关闭各一次 |
| Case finalizer | 所选 Sandbox Case | 每 Attempt 一次 | 每窗口一次 |

build 与 start 是两件事。
相同 BuildKey 可以复用不可变产物,每个 fresh Attempt 仍创建独立运行实例。

Requirement install 不是 Base build。
它发生在完整 Case ready 之后,并且只有 verify miss 的 Requirement 才检查 prepare、上传与安装能力。

Fixture 也不是 Requirement。
`W` 服从既有 Eval 生命周期,不参与 Base 选择、Requirement identity 或融合表。

## 一条 fresh Attempt

```text
声明与规划
  -> resolve E[p] and X
  -> select E[p] / X / F[p] / N
  -> build or locate selected artifact
  -> start full Sandbox Case
  -> wait services/resources ready
  -> verify R-E + R-X
  -> prepare/install/recheck misses
  -> full-group verify R-E + R-X
  -> establish workdir baseline
  -> W: Eval setup and Fixture
  -> A: check/prepare/install/recheck
  -> S.load
  -> final verify R-E + R-X + Agent
  -> Agent turn and scoring
  -> Eval and Agent paired teardown
  -> S.save
  -> Case finalizer and Sandbox stop
```

`S.load` 位于 AgentProvisioner Ensure 之后。
需要 Agent CLI 才能恢复外部状态的 C6 因此有明确位置。

状态载入后仍执行三份最终检查。
状态或 Agent 安装破坏题目、实验或 Agent 条件时,第一条 Agent turn 不会开始。

单数 Requirement 不会在这条时间线上自动拆开。
一个复合 `R-X` 内部的成员身份、依赖、资源等待和错误仍然合并在同一个活动中。

## `sandboxReuse` 生命周期

```text
window open
  -> resolve/build/start one selected Case
  -> first Attempt:
       verify/Ensure R-E + R-X
       -> establish baseline + W
       -> A Ensure
       -> S.load once
       -> final three-owner verify
       -> Agent turn

later Attempt
  -> ensureLifetime
  -> reset workdir to the window baseline
  -> verify/Ensure R-E + R-X again
  -> rebuild W
  -> A Ensure again
  -> keep live S; do not load again
  -> final three-owner verify again
  -> Agent turn

window close
  -> finish paired Eval and Agent teardown
  -> S.save once
  -> Case finalizer and Sandbox stop
```

一个窗口只承接相同 Experiment、相同 profile 与相同所选 CaseKey。
不同 `E[p]`、`X` 或 `F[p]` 不共享运行实例。

复用的是 Case 实例与 workdir 外的活状态,不是上一次 Attempt 的验证结论。
三份 Requirement 每 Attempt 都重新检查;前一次安装通常只让下一次 verify 命中。

状态放在 workdir 外才能跨 reset 存活。
依赖确定顺序或单份累积状态时,Experiment 还要把并发限制为一条窗口。

## C1-C10 的 Base 选择

| Case | PLAN-4 选中的 Base/template | start 后发生什么 | 结论 |
|---|---|---|---|
| C1 评估环境较重 | 无显式 SandboxSpec 起点时选 `E[p]` | `R-E` verify;`R-X` 与 `A` Ensure | 覆盖,但普通显式 template 会制造双 Base |
| C2 实验环境较重 | 显式 template 被算作 `X`;否则选 `N` | 每条 fresh Attempt 验证并补齐 `R-X` | 覆盖 |
| C3 双方都较重 | Experiment 无 Base 时选 `E[p]` | `R-X` 在 Eval Case 中 prepare、安装和复检 | 覆盖可安装条件 |
| C4 组合多个条件 | Base 沿 C1-C3 | 多个条件压进一个复合 `R-X` | 部分覆盖 |
| C5 预装稳定条件 | 预装可以位于 `E[p]`、`X` 或 `F[p]` | 三份 Requirement 仍真实 verify | 覆盖 |
| C6 新 Sandbox 外部状态 | Base 沿 C1-C5 | `R-E+R-X -> W -> A -> S.load`;收尾 save | 覆盖 |
| C7 复用活状态 | 每窗口选择一个 `N/E/X/F` | `S` 每窗口 load/save;三份 Requirement 每 Attempt 检查 | 覆盖 |
| C8 Experiment 条件基底 | `environment.base` 或显式 SandboxSpec 起点成为 `X` | `R-X` verify;`R-E` 与 `A` Ensure | 覆盖 |
| C9 双方不可叠加 Base | 精确 `F[p]` | 启动后分别验证 `R-E` 与 `R-X` | 覆盖 |
| C10 混合批次 | 无 Base Eval 选 `X`;带 Base Eval 被要求 `F[p]` | 普通默认 template 也触发融合表 | 不覆盖 |

C3 只有在 Experiment 不贡献 Base,并且 SandboxSpec 没有显式普通起点时保持单 Base。
一旦配置普通 template,本方案就把它解释成 `X`,转入双 Base 分支。

### C10 的错误分支

```text
用户意图:

ordinary template T
  -> Eval A has E[p]: let E[p] start
  -> Eval B has no Base: let T start

PLAN-4 interpretation:

T is X

Eval A: E[p] + X -> require F[p] ====> start
Eval B: no E[p] + X -> X ============> start
```

本方案没有一个位置把 `T` 标记成“只在没有 Eval Base 时使用的普通默认 Case”。
让 `E[p]` 静默覆盖 `X` 又会破坏真正的 Experiment Base,所以不能靠优先级修补 C10。
