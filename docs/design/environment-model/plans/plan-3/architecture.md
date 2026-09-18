# PLAN-3：Architecture

本篇是 PLAN-3 的 Case 读取、Addon 调度、生命周期、身份和失败语义单一出处。
公开 API 见 [Library](library.md)。

## 三类对象不合并

`Sandbox Case` 保留既有完整运行单位：

```typescript
interface MaterializedSandboxCase {
  caseKey: string;
  sandbox: Sandbox;
  capabilities: ReadonlySet<string>;
  facts: JsonValue;
  stop(): Promise<void>;
}
```

真实 Case 还可以带 services 等独立能力句柄。
上面的最小形状只强调 Addon 与 AgentProvisioner 都在同一个主 `Sandbox` 中收敛，不把伴随资源并入 Sandbox 接口。

Addon 的读取结果同时保留声明身份与逐目标身份：

```typescript
interface ResolvedAddon {
  name: string;
  declaredIdentity: AddonIdentity;
  targetPlatform: string;
  preparedIdentity?: AddonIdentity;
  dependencies: readonly string[];
  resources: readonly string[];
}
```

AgentProvisioner 保留自己的读取结果、安装模式与安装事实。
Runner 可以把两类安装的资源请求交给同一个调度器，但不能把 Agent 数据投影成 Addon 数据。

## `Sandbox Case` 读取

Eval environment 按既有两张表读取：

1. profile 先查 SandboxSpec 的 `environments` 表。
2. folder-local source 在同 profile 没有显式 Case 时，交给对应 Sandbox source builder。
3. Eval 没有 environment 时使用 SandboxSpec 的普通默认 Case。

同一 profile 的 `environments` 表项优先于 folder-local source。
这只是 Eval Case 的预制实现，不表示 Experiment 提供了第二份 Base。

缺失 profile 或声明非法在创建 Sandbox 前一次穷举报错。
声明合法但当前 Provider 缺 Sandbox source builder 或必要能力时，该组合计划期 `skipped`；选中集合全部 skipped 时升级为启动期错误。

本方案没有 Experiment Base、融合 Case 或可移植 Eval Addon。
这些不是运行时选择的隐藏分支，而是明确的能力边界。

## Addon 调度

规划期先校验 Addon name、缺失依赖与依赖环，再建立 DAG。

- 未声明 `resources` 的自定义 Addon 使用 `sandbox-mutation`，彼此串行。
- 相同 resource 互斥。
- 依赖全部成功、且 resource 不冲突的节点可以并行。
- `dependsOn` 只表达语义依赖，不代替 resource。
- 一个节点失败后，依赖它的节点记为 blocked；其它独立分支可以完成并保留各自诊断。

单个 Addon 的收敛过程为：

```text
check actual identity
  ├─ satisfied → hit
  └─ miss
       → lazy prepare when declared
       → install
       → check actual identity again
```

prepare 只在 miss 后启动。
single-flight key 是：

```text
Addon name + declared identity + target platform
```

Sandbox 已经创建并占用 Provider 资源，因此等待共享 prepare 继续消耗 Attempt deadline。
prepare 自身登记 Run 级共享 activity；每个等待者登记同一 origin。

所有 install 完成后，Runner 对全部 Addon 做一次真实全组复检。
这次复检不读取受管 manifest，也不复用另一条 Attempt 的检查结果。
后安装项破坏先安装项时，错误点名失败 Addon，以及它上次通过后执行过安装的候选破坏者。

## 与 AgentProvisioner 的屏障

AgentProvisioner 继续在 Adapter 的 `agent.setup` 中执行自己的 check、prepare、install 与 recheck。
它复用同一资源调度设施，但不加入 Addon DAG，也不改用 Addon 的检查结果。

Agent Ensure 完成后、第一条 Agent turn 之前，Runner 再真实检查全部 Addon。
这个跨 owner 屏障涵盖 Sandbox 状态 Hook 和 Agent 安装可能造成的破坏。

屏障 miss 时 Attempt `errored`。
Runner 不在屏障后交替重装 Addon 与 Agent，因为两套安装互相破坏时没有保证终止的通用收敛算法；诊断必须指出最后修改过冲突资源的 owner。

## 生命周期

setup 侧顺序固定：

```text
Run 级读取 Case、协调 BuildKey
  → 每 Sandbox 创建完整 Case 并等待 ready
  → 每 Attempt Addon check / prepare / install / 全组复检
  → 每 Sandbox 执行 Sandbox setup 状态 Hook
  → 建立 workdir baseline，执行 Eval setup 与 Fixture
  → 每 Attempt AgentProvisioner Ensure
  → 跨 owner Addon 验证屏障
  → Agent turn 与评分
```

Addon 位于状态 Hook 之前，所以状态载入可以使用普通实验工具。
状态 Hook 仍早于 AgentProvisioner Ensure；需要 Agent CLI 才能载入状态的场景不满足根 C6 的精确时序，这是本方案的显式缺口。

teardown 按既有生命周期逆序执行 Eval、Agent、Sandbox 状态 Hook 与 `Sandbox Case` finalizer。
Addon 没有 teardown。

## Sandbox 复用

`sandboxReuse: true` 只改变 Case 实例的生命周期，不改变验证义务：

- 只在同 CaseKey 的复用周期内共享实例。
- 每条 Attempt 都真实执行全部 Addon `check`。
- 每条 Attempt 都执行 AgentProvisioner Ensure。
- 每条 Attempt 在 Agent turn 前经过跨 owner 屏障。
- workdir 按既有复用契约重置；`$HOME`、系统目录、后台进程和外部状态可以存续。

每个复用周期继续使用既有周期身份、Sandbox setup/teardown 与载入、回存登记。
Addon 不吸收这份运行状态，也不改变复用周期的并发边界。

Addon 安装很慢不自动开启复用。
默认仍是一条 Attempt 一个全新 Case；稳定内容可以预装，实际检查命中后跳过安装。

## 身份

声明身份与逐目标读取身份分层：

```text
configHash
  += Experiment Addon 的排序后
     { name, identity, dependsOn, resources }
  += AgentProvisioner 声明 identity 与安装模式

逐 Eval fingerprint
  += Eval environment 与读取后的 CaseKey
  += Addon 的 target platform 与 prepared payload identity
  += AgentProvisioner 的 target platform 与 staged payload identity
```

Addon 集合参与 configHash 前按 `name` 排序；排序不表示执行顺序。
同一声明在不同目标平台读取出不同 payload 时，只改变对应 Eval fingerprint，不让 Run 级 configHash 按 Eval 分叉。

预制 Case 的 locator 会进入 Case 身份，但不会跳过 Addon 或 Agent 检查。
实际 identity 与运行 facts 用于审计声明是否兑现，不能反过来替代规划期身份。

## 数据落盘

Run 级数据保存：

- Addon 的 name、声明 identity、dependsOn 与 resources。
- AgentProvisioner 的声明 identity 与安装模式。
- Case、Addon prepare 与 Agent payload prepare 的共享 activity origin。

Attempt 级数据保存：

- 实际 CaseKey、平台与 Case facts。
- 每个 Addon 的首次检查、是否安装、安装后复检、全组复检、跨 owner 复检与耗时。
- Addon 的实际 identity、非敏感 facts 和命中的准备 origin。
- AgentProvisioner 的检查命中、本次安装、实际版本、复检与 staged payload 事实。

活动名保留领域：

```text
sandbox.addon.<name>.check
sandbox.addon.<name>.prepare
sandbox.addon.<name>.install
agent.artifact.prepare
agent.ensure.check
agent.ensure.install
```

## 失败语义

| 失败点 | 结果 |
|---|---|
| Case/profile 配置非法 | 启动期错误，一次穷举，零 Sandbox 创建 |
| Provider 缺 Case creator 或能力 | 计划期 `skipped`；全部 skipped 时启动期错误 |
| Case 构建、启动或 ready 失败 | 依赖 Attempt `errored`，保留 Case 证据 |
| Addon 依赖缺失、重名或成环 | 启动期配置错误，一次穷举 |
| Addon check 抛错 | Attempt `errored`，归 Sandbox 准备 |
| Addon prepare 失败 | 全部等待者 `errored`，指向同一共享 activity |
| Addon install 或立即复检失败 | Attempt `errored`，依赖节点 blocked |
| 全组复检失败 | Attempt `errored`，列出候选破坏者 |
| Agent Ensure 失败 | Attempt `errored`，phase 归 `agent.setup` |
| 跨 owner 屏障失败 | Attempt `errored`，点名冲突资源与最后修改 owner |

任一 Sandbox 准备失败都发生在第一条 Agent turn 之前，不记成 Agent 做题 `failed`。
