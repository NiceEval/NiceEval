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
W       turn 前 Eval Fixture 与 workdir 准备
V       最后一次 turn 后的隐藏 verifier / criteria
H       真实存在的早期 SandboxSpec setup / teardown Hook
S?      目标中的晚期 state load / save;Library 没有公开入口

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
| Eval | 一个 `E[p]` | 单个 `R-E` 描述题目事实;`W` 准备任务,`V` 承载隐藏判分材料 |
| Experiment | 一个 `X` 与 `F[p]` 表 | 单个 `R-X` 描述实验条件;晚期状态目标记作 `S?`,但没有公开入口 |
| Agent | 不可以 | `A` 检查、准备并安装 Agent CLI、配置与启动条件 |
| SandboxSpec | 显式起点被算作 `X` | 选择 Provider;提供早期 `H`;无显式起点时才提供不属于任何 owner 的 `N` |

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

`R-E`、`R-X`、`A`、`H`、`S?`、`W` 与 `V` 都不参与选择。
Base 只决定从哪份完整 Case 启动,不能删除三份后续检查。

规划器先展开完整 Eval 矩阵。
任一 `E[p] + X` 缺少精确 `F[p]` 时,它在创建 Sandbox 前一次列出全部缺项。

## Build、start、install 与 Fixture

| 阶段 | Owner | fresh Attempt | reuse window |
|---|---|---|---|
| 解析两侧 Base 与融合表 | Eval + Experiment | 每个 Eval 规划一次 | 每个 Eval 规划一次 |
| build 或定位起点产物 | 所选 `N/E/X/F` | Run 级按 BuildKey 协调 | Run 级共享;窗口只消费 locator |
| start、services ready | 所选 Sandbox Case | 每 Attempt 一次 | 每窗口一次 |
| `H.setup` | SandboxSpec | 每 Attempt 一次 | 每窗口一次 |
| `R-E + R-X` verify/Ensure | Eval + Experiment | 每 Attempt 一次 | 每 Attempt 一次 |
| 建立或恢复 workdir baseline | Runner / workspace | 每 Attempt 建立一次 | 每窗口建立一次,后续 Attempt reset |
| `W` Fixture | Eval | 每 Attempt 一次 | 每 Attempt 重建 |
| AgentProvisioner Ensure | Agent | 每 Attempt 一次 | 每 Attempt 一次 |
| `S?.load` / `S?.save` | Experiment 状态 | 无公开可执行相位 | 无公开可执行相位 |
| Agent turn、`V` 与 scoring | Eval | 每 Attempt 一次 | 每 Attempt 一次 |
| Eval / Agent teardown | Eval + Agent | 每 Attempt 一次 | 每 Attempt 一次 |
| `H.teardown` | SandboxSpec | 每 Attempt 一次 | 每窗口一次 |
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
  -> build or locate every artifact referenced by selected Case
  -> start full Sandbox Case
  -> wait services/resources ready
  -> H.setup
  -> verify R-E + R-X
  -> prepare/install/recheck misses
  -> full-group verify R-E + R-X
  -> establish workdir baseline
  -> W: Eval setup and Fixture
  -> A: check/prepare/install/recheck
  -> final verify R-E + R-X + Agent
  -> all Agent turns complete
  -> V: mount hidden verifier, score, then author cleanup
  -> Eval and Agent paired teardown
  -> H.teardown
  -> Case finalizer and Sandbox stop
```

真实可执行的 `H.setup` 位于 Requirement 与 AgentProvisioner 之前。
它可以承载早期环境预置,却不能保证使用 Agent CLI 恢复外部状态。

本方案描述过一条理想路径:`A Ensure -> S?.load -> final verify`。
但 Library 没有 `S?` 的独立 identity、load/save 或 activity,所以这条路径不能从公开 API 调用,C6/C7 只能部分覆盖。

单数 Requirement 不会在这条时间线上自动拆开。
一个复合 `R-X` 内部的成员身份、依赖、资源等待和错误仍然合并在同一个活动中。

## `sandboxReuse` 生命周期

```text
window open
  -> consume Run-level locators and start one selected Case
  -> H.setup once
  -> first Attempt:
       verify/Ensure R-E + R-X
       -> establish baseline + W
       -> A Ensure
       -> final three-owner verify
       -> all Agent turns complete
       -> V + scoring + author cleanup
       -> Eval and Agent teardown

later Attempt
  -> ensureLifetime
  -> reset workdir to the window baseline
  -> verify/Ensure R-E + R-X again
  -> rebuild W
  -> A Ensure again
  -> final three-owner verify again
  -> all Agent turns complete
  -> V + scoring + author cleanup
  -> Eval and Agent teardown

window close
  -> H.teardown once
  -> Case finalizer and Sandbox stop
```

一个窗口只承接相同 Experiment、相同 profile 与相同所选 CaseKey。
不同 `E[p]`、`X` 或 `F[p]` 不共享运行实例。

复用的是 Case 实例与 workdir 外的活状态,不是上一次 Attempt 的验证结论。
三份 Requirement 每 Attempt 都重新检查;前一次安装通常只让下一次 verify 命中。

若作者把状态写进 `H`,它只能按窗口早期 load、关闭时 save,并且要位于 workdir 外才能跨 reset 存活。
这仍没有独立 state identity、activity、失败或轮换语义。

`V` 仍位于 Eval `test(t)` 内,cleanup 由作者自行用 `try/finally` 实现。
本候选没有受管 cleanup 注册或独立活动,Runner 不能保证 workdir 外路径、mount 与进程已经清除,也不能因 cleanup 失败自动退休窗口。

## C1-C10 的 Base 选择

`✓` 表示覆盖共同验收,`△` 表示路径存在但丢失成员级语义,`✕` 表示规则拒绝合法输入。

| Case | 状态 | PLAN-4 选中的 Base/template | start 后发生什么 |
|---|---|---|---|
| C1 评估环境较重 | ✓ | 无显式 SandboxSpec 起点时选 `E[p]` | `R-E` verify;`R-X` 与 `A` Ensure |
| C2 实验环境较重 | ✓ | 显式 template 被算作 `X`;否则选 `N` | 每条 fresh Attempt 验证并补齐 `R-X` |
| C3 双方都较重 | ✓ | Experiment 无 Base 时选 `E[p]` | `R-X` 在 Eval Case 中 prepare、安装和复检 |
| C4 组合多个条件 | △ | Base 沿 C1-C3 | 多个条件压进一个复合 `R-X` |
| C5 预装稳定条件 | ✓ | 预装可以位于 `E[p]`、`X` 或 `F[p]` | 三份 Requirement 仍真实 verify |
| C6 新 Sandbox 外部状态 | △ | Base 沿 C1-C5 | 实际只有早期 `H.setup`;目标 `A -> S?.load -> final` 无公开 API |
| C7 复用活状态 | △ | 每窗口选择一个 `N/E/X/F` | 描述了 window cadence,但 state identity / activity 没有公开形状 |
| C8 Experiment 条件基底 | ✓ | `environment.base` 或显式 SandboxSpec 起点成为 `X` | `R-X` verify;`R-E` 与 `A` Ensure |
| C9 双方不可叠加 Base | ✓ | 精确 `F[p]` | 启动后分别验证 `R-E`、`R-X` 与 `A` |
| C10 混合批次 | ✕ | 无 Base Eval 选 `X`;带 Base Eval 被要求 `F[p]` | 普通默认 template 也触发融合表 |

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

若同一 SandboxSpec 还另外声明真正的 Experiment conditional Base,普通 `T` 与条件基底会先竞争同一个 `X` 槽位并产生重复配置错误。
因此 PLAN-4 既无法同时保留 `T` 与真正的 `X`,也无法把 `T` 只作为无 Base Eval 的 fallback。
