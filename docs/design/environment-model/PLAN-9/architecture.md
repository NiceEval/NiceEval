# PLAN-9 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 数据模型

```typescript
type SandboxRecipeOwner = "eval" | "experiment";
type SandboxStackOwner = SandboxRecipeOwner | "agent";

interface OwnedSandboxRecipe {
  owner: SandboxRecipeOwner;
  template?: SandboxTemplate;
  setup: readonly SandboxCommand[];
  teardown: readonly SandboxCommand[];
  identity?: JsonValue;
}

interface ResolvedSandboxStack {
  templateOwner: "eval" | "experiment";
  template: SandboxTemplate;
  provider: string;
  profile: string;
  caseKey: string;
  ownerOrder: readonly ["eval", "experiment", "agent"]
    | readonly ["experiment", "eval", "agent"];
}
```

Agent 不提供 template。
它出现在 ownerOrder 中，是因为 AgentProvisioner 与 Agent setup 作用于同一个主 Sandbox；内部协议不因此降格成 SandboxCommand。

## SandboxTemplate 的边界

SandboxTemplate 是“启动完整 Sandbox Case 的 recipe”这一封闭联合：

```typescript
type SandboxTemplate =
  | ComposeSandboxTemplate
  | DockerfileSandboxTemplate
  | ProfileSandboxTemplate
  | DockerImageSandboxTemplate
  | E2BSandboxTemplate
  | VercelSnapshotSandboxTemplate
  | CustomSandboxTemplate;
```

联合成员不结构同构。
Compose 成员保留资源组拓扑；E2B 成员可以只是 template ref；Custom 成员必须给出纯数据 identity 与完整 Case planner。

共同结果是 PlannedSandboxCase，不是共同实现：

```text
SandboxTemplate
  -> Provider planner
  -> PlannedSandboxCase
  -> build / start / ready
  -> RunningSandboxCase
  -> primary Sandbox + capabilities + resource-group finalizer
```

因此 PLAN-9 没有把 Compose 压成单实例 template。
“template”是作者侧起点总称，Provider-native image、E2B template 与 snapshot 仍保留各自精确类型。

## Active template 选择

每条 Attempt 按下表选择恰好一个 active template：

| Eval recipe | Experiment Provider recipe | Active template | Owner |
|---|---|---|---|
| 有 template | 任意 fallback | Eval template 或 profile 覆盖 | Eval |
| 无 template | 显式 fallback | Experiment fallback | Experiment |
| 无 template | 无显式 fallback | Provider 内建 fallback | Experiment |

Experiment fallback 不是第二个 active template。
它只在 Eval recipe 没有 template 时进入解析，不能覆盖或合并 Eval template。

folder-local template 的默认 profile 从 Eval 路径稳定推导。
`templates[profile]` 命中时替换 Provider-native 实现，但不改变 templateOwner。

纯 profile 未命中是启动期配置错误。
合法 template 没有当前 Provider planner 时，该组合计划期 `skipped`；全部 skipped 时升级为启动期错误。

## Owner stack

active template 决定唯一 ownerOrder：

```text
templateOwner = eval
  -> eval setup
  -> experiment setup
  -> agent ensure and setup

templateOwner = experiment
  -> experiment setup
  -> eval setup
  -> agent ensure and setup
```

每个 owner 内按声明顺序执行 setup。
teardown 先执行 Agent，再按 ownerOrder 逆序执行 Eval 与 Experiment；每个 owner 内继续按追加逆序。

Eval command 与 Experiment command 共用同一执行协议。
owner 是排序与记录元数据，不是 command 子类；Runner 不因 owner 改变它能调用的 Sandbox API。

Runner 不按 setup 内容、文件路径或命令字符串猜依赖。
template owner setup 只能依赖自己的 template；后续 owner 可以依赖前序结果。

## 为什么 owner 仍可同时有 template 与 setup

template 名、image digest 或受管 manifest 只证明启动输入，不证明运行事实。
template owner 仍可能需要检查版本、权限、PATH、动态库、service 健康或运行期配置。

若删除 template owner setup，预装优化就会被错误解释成条件证明。
因此 PLAN-9 的 stack 不是“一份 template 加剩下两个 owner”；它是“一份 template 加三个可为空的 owner setup”。

## Provider 负责构建与启动

Experiment Provider recipe 选择 Provider；Eval recipe 不选择。
Provider 负责把 active template 规划成完整 Case，并拥有 build、start、ready、能力句柄、证据、留存与整组 finalizer。

普通 recipe setup 只取得主 Sandbox。
它不能新增 sidecar、改变网络或 volume 拓扑，也不能把运行状态保存成一个未声明的新 template。

## Identity

完整 Attempt identity 包含：

- active SandboxTemplate identity 与 templateOwner；
- Provider planner revision、BuildKey、CaseKey 与原生产物 locator；
- 解析后的 ownerOrder；
- Experiment recipe identity，经 configHash 进入；
- Eval recipe identity，经逐 Eval fingerprint 进入；
- Agent identity、安装模式与 staged payload identity；
- Eval 源码、数据与普通本地 transfer manifest。

template 物理实现相同但 owner 不同时，ownerOrder 可能不同，因此 fingerprint 也必须不同。
Runner 指纹和记录 command 的声明源，但不从 shell 内容推导 Requirement 或软件 identity。

## Setup 频次

两条普通 recipe setup 都是逐 Attempt 语义。
fresh Sandbox 与复用 Sandbox 都按同一 ownerOrder 执行，避免 setup 相对顺序随窗口位置变化。

Provider Case 的 create、ready 与 finalizer 是每 Sandbox 或复用窗口语义。
绑定资源组寿命的日志、service watcher 与清理不进入普通 recipe setup。

## State 与 Agent

外部状态 load/save 仍是独立 Attempt lifecycle，位于工具与 Agent CLI Ensure 就位之后。
它不作为 SandboxTemplate 或普通 setup identity 的一部分，也不改变 templateOwner。

AgentProvisioner 保留平台探测、宿主侧 prepare、staged payload、安装模式、check/install/recheck 与 Agent facts。
它对 Sandbox 的最终副作用同样落成 command 和 IO，但完整协议还包含 Sandbox 外的准备与安装事实。PLAN-9 只把它排进 stack 的最后位置，不用一个 SandboxCommand 类型丢掉这些义务。

## 预制组合

Eval template 与 Experiment 条件无法按 ownerOrder 现场叠加时，Experiment Provider recipe 在 `templates[profile]` 提供完整预制 Case。
该表项仍由 Eval template 选择，因此 templateOwner 保持 Eval。

启动后所有 owner setup 仍执行真实检查。
预制 Case 只优化安装或解决不可现场组合，不吞掉任何 owner 的条件声明。

## 记录与 dry plan

`--dry` 对每条 Eval 展示 active template、templateOwner、Provider、Case 分支与 ownerOrder。
运行记录保存同一形状，再附每个 owner command 的 activity、facts、耗时与失败 phase。

动态本地上传与 Agent 可见 closure 继续执行泄漏比对。
首次运行只能事后拒绝泄漏结果；需要保密时仍使用物理隔离或 filtered context。

## 错误语义

| 失败点 | 结果 |
|---|---|
| profile 缺失、recipe/template 声明非法 | 启动期配置错误，零 Sandbox 创建 |
| Provider 不支持 template kind | 计划期 `skipped`；全 skipped 升级启动期错误 |
| build、start、ready 或资源组失效 | Attempt `errored`，归 Sandbox Case |
| Eval recipe setup | Attempt `errored`，归 `sandbox.setup.eval` |
| Experiment recipe setup | Attempt `errored`，归 `sandbox.setup.experiment` |
| Agent Ensure 或 setup | Attempt `errored`，归 `agent.setup` |
| State load/save | Attempt `errored`，归独立 state phase |
| 动态泄漏比对 | Attempt `errored`，不接受 verdict |

任一 setup 失败后不再进入后续 owner，Agent 不开始执行。
Runner 按已进入 owner 的逆序执行 teardown，最后始终调用 Provider Case finalizer；teardown 诊断不覆盖原始 setup 错误。
