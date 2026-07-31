# PLAN-5 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

本篇只回答四个运行问题:

1. Eval、Experiment 与 Agent 分别贡献什么。
2. image、template、snapshot、Dockerfile 与 Compose 同时出现时,到底从哪一个启动。
3. Base build/start、环境安装、状态、Fixture 与 Agent runtime setup 按什么顺序执行。
4. `sandboxReuse` 打开后,哪些步骤每窗口一次,哪些步骤仍然每 Attempt 执行。

## 图例

```text
D       SandboxSpec default case
E[p]    environment profile 为 p 的 Eval Base
X       Experiment conditional Base
F[p]    已融合 E[p] 与 X 的完整 case
R-E     Eval Requirement 集合
R-X     Experiment Requirement 集合
A-P     AgentProvisioner 的 CLI / 启动条件 Ensure
A-R     Agent runtime setup、verify 与 teardown
H       SandboxSpec setup / teardown Hook
S       独立的 Experiment state load / save
W       turn 前可见的 Eval Fixture
V       turn 后才挂载的 verifier / criteria Fixture

====>   被选为唯一 Base Case,负责 build/start
....>   不负责启动,在已启动 Sandbox 中 verify/Ensure
  ×     本方案拒绝该组合或无法表达
```

template 只是 Base Case 的一种输入。
Compose、Dockerfile、image 与 snapshot 使用同一套选择规则。
下面写 `template` 时不表示 Runner 会把完整 Compose 压成单 template。

## 三方声明

| Owner | 可以贡献 Base | 安装与运行职责 |
|---|---|---|
| Eval | `E[p]` | `R-E` 描述题目环境事实;`W` 准备可见工作区,`V` 在 turn 后挂载隐藏判分材料 |
| Experiment | `X` 与 `F[p]` | `R-X` 描述实验条件;`S` 独立载入和回存外部实验状态 |
| Agent | 不可以 | `A-P` 确保 CLI;`A-R` 收敛并验证鉴权、配置、Plugin、Skill 与 MCP |
| SandboxSpec | 只提供 `D` 与 `environments[p]` | 选择 Provider、materializer、普通默认起点与早期 `H`,不拥有实验条件 |

Agent CLI 可以预装在 `D`、`E[p]`、`X` 或 `F[p]` 中。
预装只会让 AgentProvisioner 检查命中,不会把 Agent 变成 Base owner。

`environments[p]` 是 `E[p]` 的预制替代实现。
它不是 `X`,也不是 `F[p]`。

## Base 选择

```text
resolve E[p] = environments[p] > Eval contribution base > none
resolve X    = Experiment contribution base > none

E[p] + X  ───────────────> F[p] ====> start
E[p] only ───────────────── E[p] ====> start
X only    ─────────────────── X ====> start
neither + D ──────────────── D ====> start
neither + no D ── Provider neutral case ====> start
```

Agent、Requirement、Hook、Fixture 与状态都不参与这个优先级。
Base 选择只决定从哪份完整环境启动,不能删除任何 owner 的后续检查。

## 一条 fresh Attempt

```text
三方声明
  -> 选择唯一 Base Case
  -> build/locate every artifact referenced by the selected Base
  -> create full Sandbox Case
  -> services/resources ready
  -> H.setup
  -> R-E + R-X initial verify
  -> prepare/install/recheck misses
  -> Eval + Experiment full barrier
  -> workspace baseline
  -> A-P check/prepare/install/recheck
  -> S.load
  -> W: turn-visible Eval Fixture
  -> A-R setup + verify
  -> final verify R-E + R-X + A-P + A-R
  -> all Agent turns complete
  -> V: hidden verifier / criteria Fixture
  -> scoring + evidence
  -> V cleanup
  -> A-R teardown
  -> S.save or explicit skipped/unavailable activity
  -> Eval teardown
  -> H.teardown
  -> Sandbox Case finalizer + stop
```

Agent 被拆成两段。
`A-P` 是有身份、可预装、可检查的安装条件;`A-R` 是每 Attempt 的连接与配置,也必须提供 identity 和 verify。
这条拆分允许状态恢复发生在 Agent CLI 已经可用之后,同时让鉴权和扩展贴着 Agent turn 收敛并进入最终检查。

`A-R.setup` 一旦进入,后续任一阶段失败都在 `finally` 中执行 `A-R.teardown`。
未到达的 runtime check 与最终检查不伪造成功值;活动记录终止阶段与收尾结果。

Fixture 不属于安装。
`W` 在 Agent turn 前可见,`V` 只能在 turn 后出现,避免把隐藏测试泄给 Agent。
Eval / Experiment Requirement install 位于 baseline 前,可以成为窗口重置点的一部分。
`A-P` 位于 baseline 后,因为状态恢复必须能使用已经就位的 Agent CLI。
`S` 位于 baseline 后;开启 reuse 时,要跨 reset 演化的状态必须位于 workdir 外。
`W` 与 `V` 都随 Attempt 重建。
`V` 的 cleanup 覆盖 workdir 外路径、mount 与进程,必须在 state save、reset 或下一条 Attempt 前成功;失败会退休窗口并停止依赖该状态的序列。

| 生命周期节点 | 默认 fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Base 选择与 BuildKey 构建 | 每个 Eval 规划;Run 级按所有 BuildKey 协调 | 相同;窗口只消费 locator |
| Case create / ready、`H.setup` | 每 Attempt 一次 | 每窗口一次 |
| `R-E + R-X` Ensure | 每 Attempt 一次 | 每 Attempt 一次 |
| workspace baseline / reset | 每 Attempt 建立一次 | 首条建立,后续每 Attempt reset |
| `A-P` Ensure | 每 Attempt 一次 | 每 Attempt 一次 |
| `S.load` | `A-P` 后每 Attempt 一次 | 首条 `A-P` 后每窗口一次 |
| `W`、`A-R` 与最终屏障 | 每 Attempt 一次 | 每 Attempt 一次 |
| 全部 Agent turn、`V`、scoring、`V` cleanup、`A-R` teardown | 每 Attempt 一次 | 每 Attempt 一次 |
| `S.save` / skip | `A-R` teardown 后、Eval teardown 前 | 关窗时一次 |
| Eval teardown | `S.save` / skip 后每 Attempt 一次 | 每 Attempt 一次 |
| `H.teardown`、Case finalizer 与 stop | 每 Attempt 一次 | 每窗口一次 |

## `sandboxReuse` 生命周期

```text
Run preparation
  -> select Base and build missing BuildKeys once

window open
  -> consume locators and start selected Base
  -> services/resources ready
  -> H.setup once
  -> first Attempt:
       R-E + R-X Ensure
       -> establish workspace baseline
       -> A-P Ensure
       -> S.load once
       -> W + A-R setup/verify
       -> final verify
       -> all Agent turns complete
       -> V + scoring
       -> V cleanup
       -> A-R + Eval teardown

later Attempt
  -> ensureLifetime
  -> reset workdir
  -> R-E + R-X Ensure again
  -> A-P Ensure again
  -> keep live S; do not load again
  -> rebuild W + A-R setup/verify
  -> final verify again
  -> all Agent turns complete
  -> V + scoring
  -> V cleanup
  -> A-R + Eval teardown

window close
  -> S.save or explicit skipped/unavailable activity once
  -> H.teardown once
  -> Sandbox Case finalizer + stop
```

一个窗口只承接同一 Experiment、同一 profile 与同一 CaseKey。
不同 `E[p]`、`X` 或 `F[p]` 不共享活 Sandbox。

`sandboxReuse` 复用的是启动后的实例,不是上一次 Attempt 的检查结论。
三方 Ensure 与最终验证每 Attempt 都执行;前次安装通常只让本次 check 命中。

要跨 Attempt 演化的活状态必须位于 workdir 外。
fresh 模式的 load 可以写 workdir;reuse 模式只 load 一次,写入 workdir 的内容会在下一次 reset 时被清除。
依赖确定顺序或单份累积状态时必须使用 `maxConcurrency: 1`;否则会产生多条独立窗口。

`S.load` 成功后,Runner 进入一条统一 outer-finally。
fresh 在本 Attempt 收尾时按 state 的 `saveOn` 策略决定是否 `S.save`。
reuse 必须使用 `saveOn: "after-load"`,并在窗口关闭时执行一次 `S.save`。
`sandboxReuse: true` 与 `attempt-succeeded` 的组合在创建 Sandbox 前报配置错误。

fresh 的顺序是 `V cleanup -> A-R.teardown -> S.save/skip -> Eval teardown -> H.teardown -> finalizer/stop`,保证 state 可以读取 workdir。
reuse 每条 Attempt 执行 `V cleanup -> A-R.teardown -> Eval teardown`;窗口关闭才执行 `S.save/skip -> H.teardown -> finalizer/stop`。
reuse state 必须位于 workdir 外;Eval teardown 只能释放自己的 `W`,不得触碰 state owner 的路径或服务。

任一收尾失败都不能阻止后续收尾;Provider 已经硬丢实例时,不能执行的步骤记录为 `unavailable`。
`V` cleanup 失败是唯一无条件禁止 state save 的软实例错误,避免把隐藏判分材料写入 checkpoint;它会停止状态序列,实例硬丢同样无法 save。

## 各 Case 到底用哪个 Base

`✓` 表示该分支覆盖共同验收;缺少融合 case 而在规划期报配置错误也是 C9 的正确结果。

| Case | 状态 | 声明图 | 选中的 Base/template | 启动后的动作 |
|---|---|---|---|---|
| C1 评估环境较重 | ✓ | `E[p] ====>`、`R-E/R-X/A-P/A-R ....>` | `E[p]`;`D` 让位 | 验证题目条件,Ensure 实验与 Agent 条件 |
| C2 实验环境较重 | ✓ | `D ====>`、`R-X/A-P/A-R ....>` | 普通 `D`;预装只是命中优化 | 每个 fresh Sandbox 检查并补齐实验与 Agent 条件 |
| C3 双方较重,实验条件可安装 | ✓ | `E[p] ====>`、`R-E/R-X/A-P/A-R ....>` | `E[p]` | verify `R-E`;不造矩阵,现场 Ensure `R-X` |
| C3 双方较重,实验条件不可叠加 | ✓ | `E[p] + X -> F[p] ====>` | `F[p]` | 启动后仍验证 `R-E/R-X/A-P/A-R` |
| C4 组合多个条件 | ✓ | Base 沿 C1-C3;多个 `R-X ....>` | 不因 Requirement 数量换 Base | 依赖和资源图调度成员,结束后全组复检 |
| C5 预装稳定条件 | ✓ | `D/E/X/F ====>` 内可预装任一成员 | 仍按 E/X 规则选 Base | 预装成员 check 命中;漂移时补齐或报不兼容 |
| C6 新 Sandbox 外部状态 | ✓ | Base 沿 C1-C5;`S` 不参与选择 | 每 Attempt 启动同类 Base | `R-E/R-X/A-P -> S.load -> W/A-R -> final`;收尾 save |
| C7 复用活状态 | ✓ | 首条选 `D/E/X/F`;后续沿用同 CaseKey | 每窗口启动一次 | 每 Attempt 三方检查;窗口 load/save 一次 |
| C8 Experiment 条件基底 | ✓ | `X ====>`、`R-E/R-X/A-P/A-R ....>` | `X` | verify `R-X`;Ensure Eval 与 Agent 条件 |
| C9 双方不可叠加 | ✓ | `E[p] + X -> F[p] ====>` | 精确 `F[p]`;缺项配置错误 | 验证 `R-E/R-X/A-P/A-R`,不隐式选边 |
| C10 混合批次,无 `X` | ✓ | 有 Base:`E[p]`;无 Base:`D` | 逐 Eval 选择 `E[p]` 或 `D` | 同一 SandboxSpec 服务两组,实例不互用 |
| C10 混合批次,有 `X` | ✓ | 有 Base:`E[p]+X->F[p]`;无 Base:`X` | 逐 Eval 选择 `F[p]` 或 `X` | `D` 不制造冲突;缺 `F[p]` 一次穷举报错 |

### C3 的两条路

```text
可移植实验条件

Eval E[p] ================================> selected/start
Experiment R-X ...........................> Ensure in E[p]
Agent A-P + A-R ..........................> Ensure in E[p]

不可叠加实验条件

Eval E[p] -----+
               +--> fused F[p] ==========> selected/start
Experiment X --+
R-E + R-X + A-P + A-R ....................> verify/Ensure in F[p]
```

### C10 的逐 Eval 选择

```text
                         no conditional X       conditional X

Eval A has E[p]          E[p]                   F[p]
Eval B has no Base       D                      X

Agent Base               never                  never
Default D conflicts      never                  never
```

这张表也是 PLAN-5 相对 PLAN-4 的核心差异。
`D` 只是 fallback;只有明确绑定 Experiment Requirement 的 `X` 才触发融合。
