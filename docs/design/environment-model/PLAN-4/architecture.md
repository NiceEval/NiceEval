# PLAN-4 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 实体关系

```text
Experiment Run
├── Experiment contribution
│   ├── one Requirement
│   ├── optional Experiment Base
│   └── profile -> fused case table
├── AgentProvisioner
└── Eval matrix
    └── Eval contribution
        ├── one Requirement
        └── optional Eval Base

Attempt
├── exactly one selected Sandbox Case
├── Eval Requirement activity
├── Experiment Requirement activity
└── Agent Requirement activity
```

Requirement 描述必须成立的事实。
Base Case 与 Ensure 是兑现 Requirement 的两种路径,不是另外两份要求。
任何 Base Case 被选中后,三份 Requirement 都还存在。

## Base Case 选择

规划器先为每个 Eval 读取 Eval contribution,再读取 Experiment contribution 与 SandboxSpec 起点。
SandboxSpec 上的显式 image、template 或 snapshot 在本方案中归一为 Experiment Base。
没有显式起点时,Provider 的中性 case 不归任何 Requirement 所有。

选择算法逐 Eval 执行:

```text
evalBase = resolve Eval contribution base
experimentBase =
  Experiment contribution base
  or explicit SandboxSpec starting artifact

if evalBase && experimentBase:
  selected = experiment.cases[eval.environmentProfile]
  missing selected -> configuration error
else if evalBase:
  selected = evalBase
else if experimentBase:
  selected = experimentBase
else:
  selected = provider neutral case
```

`Experiment contribution base` 与 SandboxSpec 显式起点不能同时声明。
两者同时出现不是两个可合并的 Experiment Base,而是同一槽位重复配置。

## 融合 case 与多 Eval

融合 case 的 profile key 指向一个完整 `Sandbox Case`。
它已经由作者或构建系统组合双方起点,Runner 不读取并拼接两个 Base。

规划器先展开完整 Eval 矩阵,再一次收集缺失 profile。
只要一条双 Base 组合缺少融合 case,本次 Run 就在创建 Sandbox 前失败。
已经存在的其它表项不会先启动,避免半批运行后才发现配置不完整。

一个 Experiment 的 `cases` 表可以有多个值。
它们是不同 Eval 的候选 Base,不是一条 Attempt 上的多个 Base。
所选 profile、表项声明身份与最终 CaseKey 一起进入逐 Eval 读取结果。

## 从声明到 Agent turn

```text
validate declarations
  -> select one Base Case
  -> create and ready full Sandbox Case
  -> verify Eval + Experiment Requirements
  -> prepare/install misses under dependency and resource graph
  -> recheck installed nodes
  -> verify the full Eval + Experiment group
  -> AgentProvisioner check/prepare/install/recheck
  -> load external state when configured
  -> verify all three Requirements
  -> start Agent turn
```

安装动作完成不等于 Sandbox 已经收敛。
后安装节点可能覆写 PATH、证书或共享 prefix,所以每个节点复检之后还有两道组级屏障。

第一道屏障涵盖 Eval 与 Experiment。
第二道屏障发生在 Agent Ensure 和外部状态载入之后,涵盖 Eval、Experiment 与 Agent。
任何屏障失败都会阻止 Agent turn。

## Eval 与 Experiment Ensure 图

每个节点的稳定键是 `owner + name`。
调度器在创建 Sandbox 前完成以下声明校验:

- 节点键不能重复。
- `dependsOn` 必须存在,不能跨到更晚的 Agent 生命周期。
- 依赖图不能有环。
- 资源名必须是非空稳定字符串。
- Requirement identity 必须可以序列化。

Sandbox ready 后,调度器先并发执行不修改 Sandbox 的初始 verify。
只有未命中的节点才进入 Ensure 图。

### 依赖与资源

`dependsOn` 表达语义前置条件。
节点只有在全部依赖已经满足或安装复检成功后才可以执行。
依赖失败的节点记为 `blocked`,不会尝试安装。

`resources` 表达安装时需要独占的共享资源。
资源集合相交的节点不能并行。
没有声明资源的自定义 Requirement 自动使用 `sandbox-mutation`,因此默认保守串行。

数组位置不参与图构建。
两个节点只在依赖满足且资源集合不相交时并行。

### Prepare single-flight

`prepare` 只在初始 verify 未命中并且 `install` 存在后调用。
目标平台由已经创建的 `Sandbox Case` 读取,因此同名 Requirement 在不同平台上不会误用 payload。

共享键为:

```text
owner + name + declared identity + target platform
```

结果携带 payload identity 与 digest。
二者进入该 Eval 的读取后 Ensure 身份,也进入安装活动。

每个 Attempt 等待共享准备时仍受自己的 setup deadline 约束。
等待者超时只结束自己的等待。
共享任务没有其它有效等待者时可以取消,不能脱离所有 Attempt 无限运行。

### 安装与复检

安装能力只在 verify 未命中后检查。
一个已满足的 Requirement 不会因为当前 Sandbox 不支持上传或系统包安装而失败。

安装按节点执行以下原子状态机:

```text
missing
  -> preparing
  -> prepared
  -> installing
  -> rechecking
  -> satisfied | failed
```

`install` 成功但复检未命中属于失败。
Runner 不写成功事实,也不把受管 manifest 当作替代检查。

全部节点结束后,调度器重新 verify Eval 与 Experiment 两个根 Requirement。
这次全组检查不读取前一次检查缓存。
它负责发现后安装节点破坏先安装节点的情况。

## AgentProvisioner 边界

AgentProvisioner 在 Eval 与 Experiment 的全组屏障通过后开始。
它不参与 Base Case 选择,也不能成为融合 case 的所有者。

Adapter 继续拥有:

- Agent 声明 identity 与读取后的安装 identity。
- 目标平台与安装模式探测。
- 宿主侧 staged payload 准备。
- Agent CLI、配置与启动条件检查。
- 安装、复检和逐 Attempt 安装事实。

AgentProvisioner 可以使用同一资源协调器。
它不能与前一阶段节点跨生命周期并行,因为 Adapter 安装可能破坏共享目录。

Agent 复检后仍要执行三份 Requirement 的最终屏障。
若 Agent 安装破坏 Experiment 工具或 Eval 题目服务,错误发生在 `agent.setup`,并附上受影响 Requirement 与 Agent 安装活动。

## 外部状态与 Sandbox 复用

安装状态、外部实验状态和 workdir Fixture 保持三条独立轴。
Requirement 不增加 load、save 或 reset 字段。

### 每 Attempt 使用全新 Sandbox

外部状态 load 在三份安装条件就位后执行。
load 完成后运行最终验证屏障,然后才启动 Agent。
save 在 Attempt 收尾阶段执行,失败产生独立的状态保存诊断。

这只是内部目标相位。
本候选的 Library 没有定义独立 state lifecycle;把现有 SandboxSpec setup 直接当作 load 会在 AgentProvisioner 前过早执行。
因此 C6/C7 的状态路径只能算部分涵盖。

同一 Experiment 的 load 到 save 临界区由 Experiment 并发限制保护。
这条路径不需要开启 Sandbox 复用。

### 复用活状态

Sandbox 复用周期有自己的 window identity 与序号。
状态可以在复用周期打开时载入,在复用周期关闭时回存。

每条 Attempt 仍执行三份 Requirement 的 verify 与最终屏障。
检查缓存只允许在相同 Sandbox 实例代次和相同资源修改代次内命中。
任何安装、reset 或状态载入触及相关资源后,对应缓存失效。

## 身份与哈希

```text
Run configHash
  += Experiment Requirement declared identity
  += Experiment Base and fused cases declarations
  += AgentProvisioner declared identity

Per-Eval fingerprint
  += Eval Requirement identity
  += Eval environment profile
  += selected Sandbox Case BuildKey and CaseKey
  += resolved Requirement target platform and payload identity
  += resolved Agent target platform and staged payload identity
```

Experiment contribution 的函数体不自动哈希。
脚本、模型、证书与 payload 变化必须由 revision 或 digest 进入声明 identity。

`cases` 表作为 Run 配置落盘。
每个 Eval 实际选中的表项、CaseKey 与读取后身份进入该 Eval 的 fingerprint。
configHash 不按 Eval 分叉。

实际检查事实、活动与耗时进入 Attempt 数据。
它们解释本次运行发生了什么,不成为下一次运行跳过 verify 的依据。

## 错误模型

| 时机 | 条件 | 结果 |
|---|---|---|
| 声明期 | 重名、缺依赖、依赖环、重复 Experiment Base | 启动期配置错误,一次穷举报出 |
| 规划期 | Provider 不支持合法 source kind | 对受影响 Eval 记 `skipped` |
| 规划期 | 双 Base 缺精确 profile 融合 case | 启动期配置错误,创建 Sandbox 前列全缺项 |
| 运行期 verify | 未命中且没有 install | Sandbox 不兼容,零 Agent turn |
| 运行期能力检查 | 未命中且缺安装所需能力 | Sandbox 不兼容,零 Agent turn |
| prepare/upload/install | 命令、网络、校验或 deadline 失败 | Attempt `errored`,归 `sandbox.setup` |
| Eval/Experiment 复检 | 安装后仍未满足 | Attempt `errored`,归 `sandbox.setup` |
| Agent Ensure | Agent 检查、准备、安装或复检失败 | Attempt `errored`,归 `agent.setup` |
| 最终屏障 | Agent 或状态载入破坏先前条件 | Attempt `errored`,登记最后修改活动与失败 Requirement |

运行期不兼容和执行错误分开。
前者表示合法声明无法在所选 Base 上收敛,后者表示承诺可以完成的 Ensure 执行失败。

## 可观察活动

每个检查、准备、上传、安装、复检与组级屏障都有独立 activity。
activity 至少登记 owner、Requirement 名、开始与结束时间、结果和失败阶段。

诊断同时携带:

- 声明目标 identity 与实际 identity。
- 目标平台、payload identity 与 digest。
- 所选 Base Case、BuildKey 与 CaseKey。
- 依赖阻塞链与资源等待时间。
- 初始检查、节点复检和最终屏障检查结果。
- Sandbox 复用 window identity 与资源修改代次。

这些字段让用户区分「预装命中」「现场补齐」「后装破坏」与「无法安装」,而不是只看到一条通用 setup 失败。
