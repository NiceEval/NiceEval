# PLAN-11 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 三方声明与运行产物

```text
SandboxSpec
├── optional default case
├── profile -> Eval prebuilt environments table
└── early setup / teardown Hook chain

Experiment Run
├── Experiment contribution
│   ├── Requirement[]
│   ├── optional conditional Base
│   └── profile -> fused case table
├── optional ExperimentStateLifecycle
├── Agent contribution
│   ├── AgentProvisioner
│   └── AgentRuntimeLifecycle
└── Eval matrix
    └── Eval contribution
        ├── Requirement[]
        └── optional Eval Base

Attempt
├── exactly one selected Sandbox Case
├── Eval Requirement activities
├── Experiment Requirement activities
├── AgentProvisioner Ensure activity
├── Agent runtime setup / verify activity
└── hidden verifier materialize / cleanup activity

Attempt or reuse window
└── Experiment state load / save activity
```

Requirement 描述必须成立的事实。
Base Case 与 Ensure 是兑现事实的两种路径。
任何 Base 被选中后,所有 Requirement 成员仍然存在并执行 verify。

SandboxSpec 默认 case 没有所属 Requirement。
它只在 Eval 与 Experiment 都没有 Base 时提供普通创建起点。

Agent 不提供 Base Case,也不实现 `EnvironmentRequirement`。
某个 template 即使预装了 Agent CLI,也只会让 AgentProvisioner 的检查命中。
Agent 的版本、安装模式、扩展与启动条件仍由 Adapter 独立收敛。

ExperimentStateLifecycle 属于 Experiment 的运行状态。
它不参与 Base Case 选择,也不成为第四种 Requirement owner。
它与早期 SandboxSpec setup/teardown 是两个相位:后者在 Case ready 后立即运行,前者在 AgentProvisioner 就位后 load。

## 规划分成三层

规划器先完成声明校验,再逐 Eval 选择 Base Case,最后解析 Ensure 身份。
三层各自产生可以落盘的确定结果。

### 声明校验

创建 Sandbox 前可以确定的错误一次穷举报出:

- 同一 contribution 中 Requirement name 重复。
- `dependsOn` 指向不存在的同所有者成员。
- Requirement 依赖图有环。
- identity 不可序列化。
- Experiment 条件基底或融合 case 不符合当前 Provider 的 case 形状。
- 双 Base profile 缺少精确融合表项。
- profile 在 Eval 声明、`environments` 表与融合表之间无法解析。
- `sandboxReuse: true` 与 `saveOn: "attempt-succeeded"` 同时出现。

Provider 不支持一个合法 Sandbox source kind 时,受影响 Eval 记为计划期 `skipped`。
非法配置与 Provider 能力不足保持不同结果。

### Eval Base 解析

Eval Base 的来源按 Eval 既有优先级解析:

```text
matching SandboxSpec environments entry
  > Eval contribution base
  > no Eval Base
```

`environments` 表项是 Eval Requirement 的预制实现。
它替代同 profile 的 folder-local source 现场构建,但仍归 Eval 一侧。
表项的全部 BuildKey、locator、CaseKey、ready 与资源组义务不改变。

### 条件基底与默认 case

Experiment contribution 的 `base` 是条件基底。
它与 Experiment Requirement 集合同点声明,参与双 Base 冲突。

SandboxSpec 的 image、template 或 snapshot 是默认 case。
它不与 Experiment Requirement 绑定,不参与双 Base 冲突。

最终选择算法:

```text
if evalBase && conditionalBase:
  selected = experiment.cases[eval.environmentProfile]
  missing selected -> configuration error
else if evalBase:
  selected = evalBase
else if conditionalBase:
  selected = conditionalBase
else if sandboxSpec.defaultCase:
  selected = sandboxSpec.defaultCase
else:
  selected = provider neutral case
```

默认 case 只在最后两档出现。
这条顺序让有题目 Base 与没有 Base 的 Eval 可以共享一个 SandboxSpec。

## 融合 case 与多 Eval

融合 case 是用户或构建系统已经组合两侧条件的完整 Sandbox Case。
Runner 不解析并合并 Eval Base 与条件基底。

规划器展开完整 Eval 矩阵后,一次收集所有双 Base 缺项。
只要一条组合缺少精确 profile 表项,本次 Run 就在创建 Sandbox 前失败。
其它已配置 profile 不先运行。

`environments` 与融合 `cases` 同时命中时,融合表项优先。
前者只预期兑现 Eval Requirement,后者预期兑现 Eval 与 Experiment 两侧。
承诺范围不同决定选择优先级,但两者启动后都必须执行逐成员 verify。

一次 Experiment 可以声明多个融合 case。
矩阵展开后,每条 Attempt 仍只选择一个完整 case。
所选 profile、表项声明身份、全部 BuildKey、locator 与 CaseKey 进入逐 Eval 解析结果。

## 三方生命周期

生命周期先回答「用谁的 Base」,再回答「怎样启动」与「三方怎样安装」。
build、start、install 和 reuse 是四种不同动作,不能用 template 一个词代替。

```text
collect owners
  Eval        -> Requirement[] + optional Eval Base + profile
  Experiment  -> Requirement[] + optional conditional Base + fused cases + state
  Agent       -> AgentProvisioner + AgentRuntimeLifecycle; no Base

resolve one Base Case
  -> build or locate every referenced artifact
  -> create and ready one full Sandbox Case
  -> SandboxSpec setup Hook chain

converge owners in the running Sandbox
  -> Eval + Experiment Requirement verify
  -> prepare/install/recheck misses
  -> full Eval + Experiment barrier
  -> workspace baseline
  -> AgentProvisioner check/prepare/install/recheck
  -> ExperimentStateLifecycle.load when configured
  -> turn-visible Eval Fixture
  -> Agent runtime setup and verify
  -> final Eval + Experiment + AgentProvisioner + Agent runtime barrier
  -> complete all Agent turns
  -> mount hidden verifier material
  -> scoring and evidence
  -> hidden verifier cleanup
  -> Agent runtime teardown
  -> state save according to saveOn
  -> Eval teardown
  -> SandboxSpec teardown, Case finalizer and stop
```

Base Case build 负责镜像、template、snapshot 或 Compose 构建产物集合。
一个 Compose Case 可以引用零个、一个或多个 BuildKey,同时记录只拉取镜像的 digest。
BuildKey 命中只复用对应构建产物,不复用活 Sandbox。
start 从选中的完整 Base 创建主 Sandbox、伴随服务和资源组,并等待 ready。

SandboxSpec setup 是现有的早期环境 Hook,位于 ready 与首次 Requirement verify 之间。
它不是外部状态 load,也不因为 `sandboxReuse` 打开而改变到 Agent 之后。

install 只处理已经启动的 Sandbox 中未满足的条件。
Eval 与 Experiment 的成员进入同一依赖和资源图;AgentProvisioner 随后保持独立 Ensure。
Experiment state、Fixture 与 Agent runtime setup 分别保持自己的 cadence。
数组来源和 template 来源都不改变 owner。

安装成功不等于三方条件已经收敛。
后安装成员可能覆盖 PATH、证书、动态库或共享 prefix。
因此逐成员复检之后还存在两道不可省略的全组屏障。

第一道屏障覆盖 Eval 与 Experiment 的完整 Requirement 集合。
第二道屏障发生在状态、Fixture 与 Agent runtime setup 之后。
它重新运行两组 Environment verify、AgentProvisioner check 与 Agent runtime verify。
任一失败都阻止 Agent turn。

Eval Fixture 分成两个可见性窗口。
turn 前的 setup 与 Fixture 可以被 Agent 看到;隐藏 verifier、official tests 与 criteria 只能在最后一次 Agent turn 返回后挂载,再进入断言求值。
Base build content 也不能携带本应隐藏的判分材料。

隐藏 verifier 的 materialization 与 cleanup 必须成对。
materialization 一旦进入,无论 verifier、断言求值或后续阶段怎样退出,cleanup 都在 `finally` 中运行。

Library 的 `HiddenVerifierMaterializeContext.onCleanup()` 要求作者在取得每项外部资源前登记收尾,Runner 按 LIFO 执行并记录结果。
cleanup 覆盖 workdir 外的路径、mount、进程和临时凭据,并且必须在下一条 Attempt、state save 与 Sandbox reset 之前成功。

cleanup 失败时 Attempt 记为 `errored`,跳过 state save 并退休窗口,避免下一条 Agent 看到上一题的判分材料。
这套受管语义不同于普通 `EvalDef.teardown`;后者仍只追加 teardown 诊断。

## Requirement 调度图

每个成员节点的稳定键是 `owner + name`。
Eval 与 Experiment 分别保持命名域,但解析后的资源调度图统一考虑两个集合。

### 初始 verify

Sandbox Case ready 后,调度器先执行全部只读 verify。
verify 可以并行,但必须遵守同一 Sandbox API 的安全并发限制。

检查结果分三类:

| 结果 | 后续 |
|---|---|
| satisfied | 记录实际 identity 与 facts,不检查安装能力 |
| missing 且有 install | 进入 Ensure 图 |
| missing 且无 install | 该组合运行期不兼容 |

运行期不兼容在 Agent 前终止该 Attempt。
它表示合法声明无法在所选 Base 上收敛,不是安装执行失败。

### 安装能力检查

只有进入 Ensure 图的成员才检查 Sandbox 上传、命令、权限或 Provider 扩展能力。
能力不足产生运行期不兼容。

这条顺序允许预装命中的 Requirement 在受限 Provider 上运行。
Runner 不会因为一条不会执行的 install 路径不可用而拒绝它。

### 依赖与资源

`dependsOn` 表达同一所有者集合中的语义前置条件。
成员只有在所有依赖已经满足或安装复检成功后才可以执行。
依赖失败的成员记为 `blocked`,不调用 prepare 或 install。

`resources` 表达安装期间需要独占的共享资源。
资源集合相交的成员不能并行。
没有声明资源的自定义 Requirement 自动使用 `sandbox-mutation`。

数组位置不参与图构建。
只有资源互不冲突且依赖已经满足的成员可以并行。

### Prepare single-flight

`prepare` 只在初始 verify 未命中、install 存在且能力满足后调用。
目标平台来自已经创建的 Sandbox Case。

共享键为:

```text
owner + name + declared identity + target platform
```

准备结果携带 payload identity 与 digest。
两者进入对应 Eval 的解析后 Ensure 身份与安装 activity。

每个 Attempt 等待共享准备时继续消耗自己的 setup deadline。
单个等待者超时不延长共享任务。
仍有其它有效等待者时任务可以继续;所有等待者离开后不能无限保留。

### 安装、复检与全组屏障

每个成员执行以下状态机:

```text
missing
  -> preparing
  -> prepared
  -> installing
  -> rechecking
  -> satisfied | failed
```

install 返回成功但复检未命中属于执行失败。
Runner 不写成功事实,也不把 manifest 当成复检结果。

所有成员结束后,Runner 重新 verify Eval 与 Experiment 的每个成员。
这次检查不读取安装前的状态 cache。
它负责发现后装成员破坏先装成员。

## Agent 的两段边界

AgentProvisioner 在第一道全组屏障通过后开始。
它不进入 Environment contribution,不参与 Base 选择,也不能成为融合 case 所有者。

Adapter 把 Agent 生命周期分成两段。
AgentProvisioner 负责有身份、可预装和可检查的 CLI / 启动条件。
AgentRuntimeLifecycle 逐 Attempt 写入并验证鉴权、配置与扩展。

Adapter 继续负责:

- Agent 声明 identity 与目标环境解析 identity。
- 目标平台与安装模式探测。
- 宿主侧 staged payload 准备。
- Agent CLI 与启动条件检查。
- 安装、复检与逐 Attempt 安装事实。
- 鉴权引用、配置 digest、Plugin、Skill 与 MCP 的 runtime identity。
- runtime setup 后的真实 verify,以及与 setup 成对的逐 Attempt teardown。

AgentProvisioner 可以复用准备 single-flight、deadline 和资源互斥协调器。
它不与更早的 Requirement 节点跨生命周期并行。

Agent 安装可能修改与实验工具相同的 prefix。
runtime setup 也可能静默漏装 Plugin、Skill 或 MCP。
因此最终屏障重新调用 AgentProvisioner check 与 AgentRuntimeLifecycle verify,不能用 CLI 存在代替 runtime 可用。
屏障失败时,诊断记录受影响成员和 Agent 安装 activity。

AgentRuntimeLifecycle 也遵守 entered-at 成对语义。
一旦调用 runtime setup,即使 setup、verify、最终屏障、Agent turn、verifier 或断言求值失败,Runner 都在 `finally` 中执行 runtime teardown。
teardown 失败不覆盖更早的主错误,但会退休复用窗口;活动以 `terminatedAt` 与可选阶段结果表达未到达的检查。

## Sandbox 复用

安装状态、外部实验状态、workdir Fixture 与 Agent runtime 是四种不同职责。
Requirement 不提供 load、save、reset 或 Fixture 字段。

复用键至少包含 Experiment、解析后的 environment profile 与所选 CaseKey。
不同 profile、不同 CaseKey 或不同 Experiment 不共用活 Sandbox。
BuildKey 构建缓存、prepare single-flight 与活 Sandbox 复用是三套独立机制。

### 每 Attempt 使用全新 Sandbox

每条 Attempt 都选择 Base、创建并 ready 一份新 Sandbox Case,然后执行早期 SandboxSpec setup。
三方检查和安装在这份实例中完成;SandboxSpec teardown 也逐 Attempt 执行。

Experiment 状态由独立的 ExperimentStateLifecycle 载入和回存,不复用 SandboxSpec Hook 相位。
PLAN-11 把 load 放在 Eval / Experiment Ensure 与 AgentProvisioner 就位之后,把 save 放在 Agent runtime teardown 与 Eval teardown 之间。
load 可以使用 Agent CLI,但不能依赖尚未执行的 Agent runtime setup。
状态载入后的三方最终屏障负责发现状态恢复造成的环境破坏。
fresh state 可以写 workdir,因为 save 在可能清理 turn 前 Fixture 的 Eval teardown 之前读取它。

同一 Experiment 的 load 到 save 临界区由 Experiment 并发限制保护。
这条路径不要求 `sandboxReuse`。

### 复用活 Sandbox

`sandboxReuse: true` 让同一复用键的多条 Attempt 共用已经启动的 Sandbox Case。
一个窗口只创建、ready、执行 SandboxSpec setup 和载入状态一次。
窗口关闭时回存状态,再执行 SandboxSpec teardown、Case finalizer 与 stop。

每条 Attempt 仍执行以下动作:

1. 确认 Sandbox 寿命;首条 Attempt 在 Eval / Experiment Ensure 后建立 baseline,后续 Attempt 先 reset 到该点。
2. 重新 verify 全部 Eval 与 Experiment Requirement;只为 miss 执行 install。
3. 重新执行 AgentProvisioner Ensure;前次安装通常让 check 命中。
4. 窗口首条 Attempt 载入状态;后续 Attempt 直接使用活状态。
5. 重建 turn 前 Fixture,执行并验证 Agent runtime setup。
6. 运行三方最终屏障,完成所有 Agent turn 后再进入隐藏 verifier、断言求值与证据收集。
7. 执行 Agent runtime teardown;窗口不在此时 save,随后执行 Eval teardown。

需要跨 reset 演化的状态、全局安装与 cache 必须位于 workdir 之外。
Requirement install 位于 baseline 前,可以把可重置的环境内容写进 workdir。
state load 位于 baseline 后;fresh 模式可以写 workdir,reuse 模式要跨 Attempt 演化的状态必须位于 workdir 外。
turn 前 Fixture 与 turn 后 verifier 都随 workdir 每 Attempt 重建。
Eval teardown 只能释放对应 Eval setup / Fixture 自己取得的资源,不能删除 ExperimentStateLifecycle 拥有的 workdir 外状态。

窗口记录独立 identity 与承接序号。
需要确定顺序或单份累积状态的 Experiment 必须使用 `maxConcurrency: 1`。
并发大于一会建立多条窗口,每条窗口拥有自己的活状态与安装命中历史。

检查 cache 只有在相同实例代次、成员 identity 与资源修改代次下有效。
安装、reset 或状态载入触及相关资源后,对应 cache 失效。

### 状态失败、取消与窗口轮换

`state.load` 失败时当前 Attempt 记为 `errored`,窗口立即退休,不会承接下一条 Attempt。
`state.save` 失败不反改已经完成的题目 verdict,但使该 Experiment 的状态序列失败;Runner 停止继续派发依赖这份状态的 Attempt。

`saveOn: "after-load"` 表示 load 成功后,Fixture、runtime、最终屏障、Agent turn、verifier、断言求值或 teardown 失败都在 outer-finally 尝试 save。
`saveOn: "attempt-succeeded"` 只用于 fresh。
本 Attempt 的 Agent turn、verifier、断言求值、隐藏判分 cleanup 与 Agent runtime teardown 全部成功才 save。
reuse 没有逐 Attempt 状态回滚,因此只能使用 `after-load`;非法组合在创建 Sandbox 前报配置错误。

Eval teardown 仍沿既有规则只追加诊断;fresh save 位于它之前,所以这类诊断不反改 checkpoint。
两者遇到隐藏判分 cleanup 失败都跳过 save;Provider 硬丢实例时 save 记为 `unavailable`。

可处理的取消、Attempt timeout 与 Sandbox lifetime 轮换都遵守同一 `saveOn` 策略。
save 获得独立 cleanup budget 和 signal,不继承已经过期的 Attempt deadline。
`rolling` 轮换只有在旧窗口 save 成功后才创建并从该 checkpoint load 替代窗口。
`pinned` 新窗口始终重新载入声明的固定 revision;旧窗口 save 只是输出,不成为后继。
SIGKILL、断电或 Provider 硬丢实例无法承诺 save;记录保留最后成功 load/save 的 digest。
后续 `rolling` 只能从最后已提交 checkpoint 恢复,`pinned` 仍回到固定 revision。

后继规则不能由 store 实现自行猜测:

| consistency | fresh 下一 Attempt | reuse 窗口轮换 |
|---|---|---|
| `pinned(revision)` | 每次都 load 固定 revision | 新窗口仍 load 固定 revision |
| `rolling` | 必须 load 上一条成功 save | 必须 load 旧窗口成功 save |

`rolling` 的同一 cohort 只允许一条 load → save 临界区,要求 `maxConcurrency: 1`。
save 失败后不存在合法后继,后续依赖该状态的 Attempt 不再派发。
fresh 的 `attempt-succeeded` 主动跳过 save 时,head 保持在 load 的 predecessor。
后续 `rolling` Attempt 从该 head 重新 load。
load 失败、隐藏判分 cleanup 失败、save 失败或 transfer unavailable 都不是主动策略,状态序列立即停止。

### 统一异常收尾

一旦 Case create 进入,Runner 用嵌套 `finally` 保证后段尽可能继续:

```text
fresh Attempt:
  hidden verifier cleanup when entered
    -> Agent runtime teardown when entered
    -> Experiment state save or explicit skipped/unavailable activity
    -> Eval teardown when entered
    -> SandboxSpec teardown when entered
    -> Case finalizer
    -> Sandbox stop

reuse Attempt:
  hidden verifier cleanup when entered
    -> Agent runtime teardown when entered
    -> Eval teardown when entered

reuse window close:
  Experiment state save or explicit skipped/unavailable activity
    -> SandboxSpec teardown when entered
    -> Case finalizer
    -> Sandbox stop
```

前一步失败不会阻止后一步。
实例仍可访问时,load/save 失败、runtime teardown 失败与 verifier cleanup 失败都必须继续执行 SandboxSpec teardown、Case finalizer 与 stop。
实例已经硬丢时,不能执行的步骤记录 `unavailable`,不伪造成功。

## 身份与哈希

Requirement identity 分声明层与解析层。
声明层描述作者选择,解析层加入目标平台、payload digest 与选中的 case。

```text
Run configHash
  += sorted Experiment Requirement declared identities
  += conditional Base declaration
  += fused cases table
  += SandboxSpec default case and environments declarations
  += AgentProvisioner declared identity
  += AgentRuntimeLifecycle declared identity
  += ExperimentStateLifecycle declared identity, consistency and saveOn

Per-Eval fingerprint
  += sorted Eval Requirement identities
  += Eval environment profile
  += selected Base Case BuildKey set, locators and CaseKey
  += resolved Eval and Experiment platform/payload identities
  += resolved Agent platform, staged payload and runtime identities
  += hidden verifier fixture identity and registered criteria digest
```

Requirement 集合按 `name` 排序后参与哈希。
依赖与资源声明也是配置语义,与每个成员一起进入声明身份清单。

`cases` 与 `environments` 全表作为 Run 配置落盘。
每个 Eval 实际选择的表项与 CaseKey 进入该 Eval fingerprint。
configHash 不按 Eval 分叉。

实际 identity、facts、activities 与耗时进入 Attempt 记录。
它们解释本次 verify 与 Ensure,不成为下一次运行跳过检查的理由。

state 的 declared identity 必须携带 store、cohort 与 schema。
`pinned` state 还携带固定 revision;`rolling` state 明确禁用结果携带,允许 checkpoint 随同一实验序列推进。
运行时 load/save 的 checkpoint identity 与 digest 进入 Attempt 或 window 记录,不事后改写派发前已经计算的 fingerprint。
只写一个浮动 store URL 但既不声明 pinned revision、也不选择 rolling,属于启动期配置错误。

## 错误与不兼容

| 时机 | 条件 | 结果 |
|---|---|---|
| 声明期 | 重名、缺依赖、依赖环、identity 非法 | 启动期配置错误,一次穷举报出 |
| 声明期 | 双 Base 缺精确 profile 融合 case | 启动期配置错误,创建 Sandbox 前列全缺项 |
| 规划期 | Provider 不支持合法 source kind | 对受影响 Eval 记 `skipped` |
| 运行期 verify | 未命中且没有 install | 环境不兼容,零 Agent turn |
| 运行期能力检查 | 未命中且缺安装所需能力 | 环境不兼容,零 Agent turn |
| prepare/upload/install | 命令、网络、校验或 deadline 失败 | Attempt `errored`,归 `environment.ensure` |
| Eval/Experiment 复检 | 安装后仍未满足 | Attempt `errored`,归 `environment.ensure` |
| Agent Ensure | Agent 检查、准备、安装或复检失败 | Attempt `errored`,归 `agent.setup` |
| Agent runtime | 鉴权、配置、Plugin、Skill、MCP setup 或 verify 失败 | Attempt `errored`,归 `agent.setup` |
| Agent runtime teardown | 成对收尾失败或超时 | 保留主错误,追加诊断并退休窗口 |
| verifier cleanup | 隐藏材料、mount 或进程未清除 | Attempt `errored`,跳过 state save、退休窗口并停止依赖该状态的序列 |
| state load | checkpoint 读取、校验或恢复失败 | Attempt `errored`,退休窗口 |
| state save skipped | save policy 未达成、load 失败或 verifier cleanup 失败 | 记录明确 reason;只有主动 save policy 允许后续从 predecessor 继续 |
| state transfer unavailable | Sandbox 已丢或 Provider 不可达 | 保留最后成功 digest,状态序列停止 |
| state save | checkpoint 提交或校验失败 | 保留已完成 verdict,标记状态序列失败并停止后续派发 |
| 最终屏障 | Agent、状态或前一条 Attempt 破坏既有条件 | Attempt `errored`,归 `environment.verify`,附最后修改活动与失败成员 |

声明期错误作用于整次 Run。
计划期 `skipped` 只作用于 Provider 无法承载的 Eval。
运行期不兼容和 `errored` 作用于已经解析到具体 Base 的 Attempt。

## 可观察活动

每次检查、准备、上传、安装、复检与组级屏障都有独立 activity。
activity 至少记录 owner、Requirement name、阶段、时点、耗时与结果。

诊断同时携带:

- 声明目标 identity 与实际 identity。
- 目标平台、payload identity 与 digest。
- 所选 Base 类型、来源、全部 BuildKey、locator 与 CaseKey。
- 默认 case 是否让位,条件基底或融合 case 是否命中。
- 依赖阻塞链与资源等待时间。
- 初始检查、成员复检和最终屏障结果。
- AgentProvisioner 与 Agent runtime 各自的 target、actual identity 和最终检查。
- 隐藏 verifier materialization、断言求值与 cleanup 的结果;不会落盘判分材料正文。
- state declared identity、load/save checkpoint identity、digest、outcome 与 window identity。
- Sandbox 复用 window identity、承接序号与资源修改代次。

这些字段让用户区分默认起点、条件基底、预装命中、现场补齐、后装破坏与无法安装。
