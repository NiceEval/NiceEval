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
  beforeEach: readonly SandboxCommand[];
  afterEach: readonly SandboxCommand[];
  caseScopeIdentity: JsonValue;
  attemptScopeIdentity: JsonValue;
}

interface ResolvedSandboxStack {
  templateOwner: "eval" | "experiment";
  template: SandboxTemplate;
  provider: string;
  profile: string;
  caseKey: string;
  caseScopeRecipeIdentity: string;
  poolKey: string;
  ownerOrder: readonly ["eval", "experiment", "agent"]
    | readonly ["experiment", "eval", "agent"];
}
```

`OwnedSandboxRecipe` 是 Runner 的内部归一结构，不是公开作者接口。
公开 `SandboxRecipe` 只约束 `.setup()` / `.teardown()` 与 `.beforeEach()` / `.afterEach()` 两种 scope 的 command stack；具体 factory 解析自己的 options 后，才把 template 放进这份内部结构。这样 E2B 的 `template: string`、Docker 的 `image: string`、Vercel 的 `snapshotId: string` 与 Compose 的资源组参数无需伪装成同一个公共字段类型。

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
  window open:  eval setup -> experiment setup
  attempt: eval beforeEach -> experiment beforeEach -> agent
  cleanup: agent -> experiment afterEach -> eval afterEach
  window close: experiment teardown -> eval teardown

templateOwner = experiment
  window open:  experiment setup -> eval setup
  attempt: experiment beforeEach -> eval beforeEach -> agent
  cleanup: agent -> eval afterEach -> experiment afterEach
  window close: eval teardown -> experiment teardown
```

Window scope 与 Attempt scope 分别使用同一 ownerOrder。
每个 owner 内按声明顺序执行 setup 与 beforeEach；afterEach 与 teardown 先按 ownerOrder 逆序，再在 owner 内按追加逆序执行。

Eval command 与 Experiment command 共用同一执行协议。
owner 是排序与记录元数据，不是 command 子类；Runner 不因 owner 改变它能调用的 Sandbox API。

Runner 不按 command 内容、文件路径或命令字符串猜依赖。
template owner setup 只能依赖自己的 template，后续 owner setup 可以依赖前序结果。进入 Attempt scope 时两方 setup 都已完成；template owner beforeEach 不能依赖尚未执行的第二 owner beforeEach，后续 owner则可以依赖前序的本次结果。

## 为什么 owner 仍可同时有 template 与 setup

template 名、image digest 或受管 manifest 只证明启动输入，不证明运行事实。
template owner 仍可能需要检查版本、权限、PATH、动态库、service 健康或运行期配置。

若删除 template owner setup，预装优化就会被错误解释成条件证明。
因此 PLAN-9 的 stack 不是“一份 template 加剩下两个 owner”；它是“一份 template 加两个 owner 的 Case/Attempt command，再接 Agent”。

## Provider 负责构建与启动

Experiment Provider recipe 选择 Provider；Eval recipe 不选择。
Provider 负责把 active template 规划成完整 Case，并拥有 build、start、ready、能力句柄、证据、留存与整组 finalizer。

普通 recipe command 只取得主 Sandbox。
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

复用池身份必须另行固定为：

```text
(CaseKey, templateOwner, ownerOrder, caseScopeRecipeIdentity)
```

`caseScopeRecipeIdentity` 覆盖两方 setup/teardown 的声明源、配置与顺序，避免不同窗口条件共享同一个 reset anchor。
beforeEach/afterEach 的 identity 进入 Attempt fingerprint，但不进入 pool key；因此同一兼容窗口可按当前 Eval 执行不同的 Attempt command。

template 物理实现相同但 owner 不同时，ownerOrder 可能不同，因此 fingerprint 也必须不同。
Runner 指纹和记录 command 的声明源，但不从 shell 内容推导 Requirement 或软件 identity。

## 两种 scope 与复用

fresh 模式中一条 Attempt 恰好拥有一个 Case 窗口，所以 setup/teardown 与 beforeEach/afterEach 都各运行一次。
复用模式中，两方 setup 在窗口启动时各运行一次，Runner 随后建立 reset anchor；每条 Attempt reset 到该 anchor 后，按 ownerOrder 执行两方 beforeEach。Agent diff 的 workspace baseline 在全部 beforeEach 完成后建立。

窗口结束时先按逆序执行两方 teardown，再调用 Provider Case finalizer。每条 Attempt 则在 Agent 收尾后按逆序执行 afterEach。
池只允许复用 `CaseKey`、templateOwner、ownerOrder 与 Window scope identity 都相同的窗口；Attempt scope 可随当前 Eval 改变，并由该 Attempt 自己执行。

Provider Case 的 create、ready 与 finalizer 是每 Sandbox 或复用窗口语义。
绑定资源组寿命的日志、service watcher 与清理不进入普通 recipe setup/teardown。

## State 与 Agent

外部状态 load/save 仍是独立 Attempt lifecycle，位于两方 beforeEach 与 Agent CLI Ensure 就位之后。
它不作为 SandboxTemplate 或普通 command identity 的一部分，也不改变 templateOwner。

AgentProvisioner 保留平台探测、宿主侧 prepare、staged payload、安装模式、check/install/recheck 与 Agent facts。
它对 Sandbox 的最终副作用同样落成 command 和 IO，但完整协议还包含 Sandbox 外的准备与安装事实。PLAN-9 只把它排进 stack 的最后位置，不用一个 SandboxCommand 类型丢掉这些义务。

## 预制组合

Eval template 与 Experiment 条件无法按 ownerOrder 现场叠加时，Experiment Provider recipe 在 `templates[profile]` 提供完整预制 Case。
该表项仍由 Eval template 选择，因此 templateOwner 保持 Eval。

启动后所有 owner setup 仍在窗口开始时执行真实检查，beforeEach 仍在每条 Attempt 执行。
预制 Case 只优化安装或解决不可现场组合，不吞掉任何 owner 的条件声明。需要每条 Attempt 验证的条件必须显式使用 beforeEach。

## 记录与 dry plan

`--dry` 对每条 Eval 展示 active template、templateOwner、Provider、Case 分支、ownerOrder，以及按 Window/Attempt scope 分组的 command 与执行频次。
运行记录保存同一形状，再附每个 owner command 的 scope、activity、facts、耗时与失败 phase。
Window scope command 的证据和诊断归 RunningSandboxCase / 复用窗口记录，所有借用它的 Attempt 引用该记录；Attempt scope command 则归当前 Attempt。Runner 不把窗口 setup 或窗口末尾 teardown 虚构成某一条 Attempt 的 hook。

动态本地上传与 Agent 可见 closure 继续执行泄漏比对。
首次运行只能事后拒绝泄漏结果；需要保密时仍使用物理隔离或 filtered context。

## 错误语义

| 失败点 | 结果 |
|---|---|
| profile 缺失、recipe/template 声明非法 | 启动期配置错误，零 Sandbox 创建 |
| Provider 不支持 template kind | 计划期 `skipped`；全 skipped 升级启动期错误 |
| build、start、ready 或资源组失效 | Attempt `errored`，归 Sandbox Case |
| Eval / Experiment recipe setup | 当前窗口不可用，归 `sandbox.setup.eval` / `sandbox.setup.experiment` |
| Eval / Experiment recipe beforeEach | 当前 Attempt `errored`，归 `sandbox.beforeEach.eval` / `sandbox.beforeEach.experiment` |
| Agent Ensure 或 setup | Attempt `errored`，归 `agent.setup` |
| State load/save | Attempt `errored`，归独立 state phase |
| afterEach / teardown | 保留原始结果并记录对应 cleanup phase 诊断 |
| 动态泄漏比对 | Attempt `errored`，不接受 verdict |

任一 setup 失败后不再进入后续 owner，也不开始任何 Attempt；Runner 按已进入 owner 的逆序执行 teardown，最后始终调用 Provider Case finalizer。
beforeEach 失败时 Agent 不开始执行；Runner 对已进入的 Attempt scope 执行逆序 afterEach，并在允许再次借出窗口前验证或恢复 reset 边界。cleanup 诊断不覆盖原始错误。
