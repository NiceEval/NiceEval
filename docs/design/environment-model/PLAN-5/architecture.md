# PLAN-5 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 实体关系

```text
SandboxSpec
├── optional default case
└── profile -> Eval prebuilt environments table

Experiment Run
├── Experiment contribution
│   ├── Requirement[]
│   ├── optional conditional Base
│   └── profile -> fused case table
├── AgentProvisioner
└── Eval matrix
    └── Eval contribution
        ├── Requirement[]
        └── optional Eval Base

Attempt
├── exactly one selected Sandbox Case
├── Eval Requirement activities
├── Experiment Requirement activities
└── Agent Requirement activity
```

Requirement 描述必须成立的事实。
Base Case 与 Ensure 是兑现事实的两种路径。
任何 Base 被选中后,所有 Requirement 成员仍然存在并执行 verify。

SandboxSpec 默认 case 没有所属 Requirement。
它只在 Eval 与 Experiment 都没有 Base 时提供普通创建起点。

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
表项的 BuildKey、CaseKey、ready 与资源组义务不改变。

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
所选 profile、表项声明身份、BuildKey 与 CaseKey 进入逐 Eval 解析结果。

## 从声明到 Agent turn

```text
validate declarations
  -> resolve Eval Base and conditional Base
  -> select exactly one Base Case
  -> create and ready full Sandbox Case
  -> verify every Eval + Experiment Requirement member
  -> classify runtime incompatibilities
  -> prepare/install misses under dependency and resource graph
  -> recheck installed members
  -> verify the full Eval + Experiment sets
  -> AgentProvisioner check/prepare/install/recheck
  -> load external state when configured
  -> verify all three owner sets
  -> start Agent turn
```

安装成功不等于整体已经收敛。
后安装成员可能覆盖 PATH、证书、动态库或共享 prefix。
因此逐成员复检之后还存在两道不可省略的全组屏障。

第一道屏障覆盖 Eval 与 Experiment 的完整 Requirement 集合。
第二道屏障发生在 Agent Ensure 与外部状态载入之后,覆盖三种所有者。
任一失败都阻止 Agent turn。

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

## AgentProvisioner 边界

AgentProvisioner 在第一道全组屏障通过后开始。
它不进入 Environment contribution,不参与 Base 选择,也不能成为融合 case 所有者。

Adapter 继续负责:

- Agent 声明 identity 与目标环境解析 identity。
- 目标平台与安装模式探测。
- 宿主侧 staged payload 准备。
- Agent CLI、配置与启动条件检查。
- 安装、复检与逐 Attempt 安装事实。

AgentProvisioner 可以复用准备 single-flight、deadline 和资源互斥协调器。
它不与更早的 Requirement 节点跨生命周期并行。

Agent 安装可能修改与实验工具相同的 prefix。
因此 Agent 复检后仍要运行三种所有者的最终屏障。
屏障失败时,诊断记录受影响成员和 Agent 安装 activity。

## 外部状态与 Sandbox 复用

安装状态、外部实验状态与 workdir Fixture 是三种不同职责。
Requirement 不提供 load、save、reset 或 Fixture 字段。

### 每 Attempt 使用全新 Sandbox

外部状态 load 在 Eval、Experiment 与 Agent 安装条件就位后执行。
load 完成后运行最终屏障,然后才启动 Agent。
save 在 Attempt 收尾阶段执行,失败产生独立状态保存诊断。

同一 Experiment 的 load 到 save 临界区由 Experiment 并发限制保护。
这条路径不要求 `sandboxReuse`。

### 复用活状态

复用窗口记录独立的 window identity 与序号。
状态可以在窗口打开时载入,在关闭时回存。

每条 Attempt 仍执行全部 Requirement 成员的初始 verify 与最终屏障。
检查 cache 只有在相同实例代次、成员 identity 与资源修改代次下有效。
安装、reset 或状态载入触及相关资源后,对应 cache 失效。

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

Per-Eval fingerprint
  += sorted Eval Requirement identities
  += Eval environment profile
  += selected Base Case BuildKey and CaseKey
  += resolved Eval and Experiment platform/payload identities
  += resolved Agent platform and staged payload identity
```

Requirement 集合按 `name` 排序后参与哈希。
依赖与资源声明也是配置语义,与每个成员一起进入声明身份清单。

`cases` 与 `environments` 全表作为 Run 配置落盘。
每个 Eval 实际选择的表项与 CaseKey 进入该 Eval fingerprint。
configHash 不按 Eval 分叉。

实际 identity、facts、activities 与耗时进入 Attempt 记录。
它们解释本次 verify 与 Ensure,不成为下一次运行跳过检查的理由。

## 错误与不兼容

| 时机 | 条件 | 结果 |
|---|---|---|
| 声明期 | 重名、缺依赖、依赖环、identity 非法 | 启动期配置错误,一次穷举报出 |
| 声明期 | 双 Base 缺精确 profile 融合 case | 启动期配置错误,创建 Sandbox 前列全缺项 |
| 规划期 | Provider 不支持合法 source kind | 对受影响 Eval 记 `skipped` |
| 运行期 verify | 未命中且没有 install | 环境不兼容,零 Agent turn |
| 运行期能力检查 | 未命中且缺安装所需能力 | 环境不兼容,零 Agent turn |
| prepare/upload/install | 命令、网络、校验或 deadline 失败 | Attempt `errored`,归 `sandbox.setup` |
| Eval/Experiment 复检 | 安装后仍未满足 | Attempt `errored`,归 `sandbox.setup` |
| Agent Ensure | Agent 检查、准备、安装或复检失败 | Attempt `errored`,归 `agent.setup` |
| 最终屏障 | Agent 或状态载入破坏先前条件 | Attempt `errored`,附最后修改活动与失败成员 |

声明期错误作用于整次 Run。
计划期 `skipped` 只作用于 Provider 无法承载的 Eval。
运行期不兼容和 `errored` 作用于已经解析到具体 Base 的 Attempt。

## 可观察活动

每次检查、准备、上传、安装、复检与组级屏障都有独立 activity。
activity 至少记录 owner、Requirement name、阶段、时点、耗时与结果。

诊断同时携带:

- 声明目标 identity 与实际 identity。
- 目标平台、payload identity 与 digest。
- 所选 Base 类型、来源、BuildKey 与 CaseKey。
- 默认 case 是否让位,条件基底或融合 case 是否命中。
- 依赖阻塞链与资源等待时间。
- 初始检查、成员复检和最终屏障结果。
- Sandbox 复用 window identity 与资源修改代次。

这些字段让用户区分默认起点、条件基底、预装命中、现场补齐、后装破坏与无法安装。
