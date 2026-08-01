# PLAN-9 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 数据模型

```typescript
type SandboxRecipeOwner = "eval" | "experiment";
type SandboxStackOwner = SandboxRecipeOwner | "agent";

interface OwnedSandboxRecipe {
  owner: SandboxRecipeOwner;
  templateContribution:
    | { kind: "none" }
    | {
        kind: "explicit";
        template: SandboxTemplate;
        factory: string;
        sourceModule: string;
      };
  setup: readonly SandboxCommand<"setup">[];
  teardown: readonly SandboxCommand<"teardown">[];
  beforeEach: readonly SandboxCommand<"beforeEach">[];
  afterEach: readonly SandboxCommand<"afterEach">[];
  caseScopeIdentity: JsonValue;
  attemptScopeIdentity: JsonValue;
}

interface LinkedSandboxStack {
  templateOwner: "eval" | "experiment";
  template: SandboxTemplate;
  providerFactory: string;
  ownerOrder: readonly ["eval", "experiment", "agent"]
    | readonly ["experiment", "eval", "agent"];
}

interface PlannedSandboxStack extends LinkedSandboxStack {
  provider: string;
  templateIdentity: string;
  plannedCase: PlannedSandboxCase;
}

interface FingerprintedSandboxStack extends PlannedSandboxStack {
  caseKey: string;
  windowStackIdentity: string;
  attemptStackIdentity: string;
  caseScopeRecipeIdentity: string;
  attemptFingerprint: string;
  carryEligible: boolean;
  poolKey: string;
}
```

`OwnedSandboxRecipe` 是 Runner 的内部归一结构，不是公开作者接口。
公开 `SandboxRecipe` 只约束 Window 与 Attempt 两种 scope 的 command stack。具体 factory 读取自己的 options 后，才把 template 与 Provider factory 放进这份内部结构。E2B template ref、Docker image、Vercel snapshot 与 Compose 资源组无需伪装成同一个公共字段类型。

Agent 不提供 template 或 Provider。
它出现在 ownerOrder 中，是因为 AgentProvisioner 与 Agent setup 作用于同一个主 Sandbox；内部协议不因此降格成 SandboxCommand。

## SandboxTemplate 的边界

SandboxTemplate 是“选择 Provider 并启动完整 Sandbox Case 的 recipe”这一封闭联合：

```typescript
type SandboxTemplate =
  | ComposeSandboxTemplate
  | DockerfileSandboxTemplate
  | DockerImageSandboxTemplate
  | E2BSandboxTemplate
  | VercelSnapshotSandboxTemplate
  | CustomSandboxTemplate;
```

联合成员不结构同构。
Compose 成员保留资源组拓扑并选择 Docker Compose Provider；E2B 成员携带 template ref 并选择 E2B Provider；Custom 成员必须给出纯数据 identity、Provider factory 与完整 Case planner。

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

每个实际选中的 Eval × Experiment pair 先检查作者显式 template contribution，再解析恰好一个 active template：

| Eval 显式 template | Experiment 显式 template | Active template | Owner |
|---|---|---|---|
| 有 | 有 | 配置冲突，不解析 | 无 |
| 有 | 无 | Eval template | Eval |
| 无 | 有 | Experiment template | Experiment |
| 无 | 无 | 配置缺失，不解析 | 无 |

`image`、`template`、`snapshotId`、Compose 或 Dockerfile 都是完整 template contribution，同时带出 Provider。它们不能覆盖另一侧 template，也不能被静默忽略；1×1 报 `sandbox.template-conflict`，0×0 报 `sandbox.template-missing`。

concrete factory 的返回类型已经把 template 与 Provider factory 原子绑定，link 不再做第二次 planner 完整性分支。已被 Experiment selector 选中的 pair 若在目标平台、能力或 locator 上不可用，会在只读 physical planning 聚合报错，不会自动 `skipped`；作者必须用 selector 明确排除，否则整个 Run 零资源失败。

## Discovery 后的 link planning

单个 TypeScript 模块只能检查自己这侧的 factory 与 option 形状。最终配对还取决于独立加载的 Eval、Experiment 的字符串或 predicate selector 与 CLI filter，普通 `tsc` 无法证明 pair 不变量。

Runner 先提供一个纯 link 入口：

```typescript
linkSandboxMatrix(
  discoveredEvals,
  discoveredExperiments,
): Map<ExperimentId, Map<EvalId, LinkedSandboxStack>>;
```

它在 discovery 和 Eval selection 后穷举所有实际 pair，聚合 template conflict / missing、Direct Agent 误配与空 selector。只要有一项错误，整个 Run 在 Provider 网络、fingerprint、build 与 Sandbox create 前失败；不能先创建合法 pair，再运行到错误 pair 才停止。

随后才进入 Provider 的只读 physical / network planning：解析本地 Compose / Dockerfile 与 `workspaceService`，检查目标平台和计划能力，再读取 image digest、E2B template 或 snapshot locator。这一步生成 `PlannedSandboxStack` / `PlannedSandboxCase`，可以做 Provider 只读网络请求，但仍不 build、不创建 Sandbox，也不启动模型。所有可并行检查的错误一次列全。

唯一合法阶段顺序是：

```text
discovery + selection
  -> pure link
  -> Provider read-only physical / network planning
  -> fingerprint
  -> build / Sandbox create
```

正常执行与 `--dry` 消费同一份 linked matrix、physical plan 与 fingerprint；`--dry` 在 fingerprint 后停止，不 build、不创建资源。`niceeval check <experiment>` 则只执行到 pure link 并立即返回，零 Provider 文件读取或网络请求。fingerprint、build 与 Attempt 不得各自重算 template 或 Provider 选择，否则 hard constraint 仍可能在不同路径漂移。

人类错误至少给出可直接修改的两处声明：

```text
sandbox.template-conflict: Experiment "memory/codex" and
Eval "terminal-bench/play-zork-easy" both declare a template

  eval:       composeSandbox(...) at evals/.../eval.ts
  experiment: e2bSandbox({ template: "mempal-codex-v3" }) at experiments/codex.ts

NiceEval starts one Sandbox Case and does not merge or prioritize templates.
Remove one template or split the Experiment's Eval selection.
17 conflicting pairs were found. No Sandbox was created.
```

机器诊断保留同样的 experiment id、eval id、双方 owner / factory / kind / identity / source，以及可枚举的修复类别。

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
owner 是排序与记录元数据，不是 command 子类；Runner 不因 owner 改变它能调用的 SandboxCommandTarget。该窄视图没有 `stop()` 或 Provider-native SDK，生命周期 command 不能提前销毁主 Sandbox。

Runner 不按 command 内容、文件路径或命令字符串猜依赖。
template owner setup 只能依赖自己的 template，后续 owner setup 可以依赖前序结果。进入 Attempt scope 时两方 setup 都已完成；template owner beforeEach 不能依赖尚未执行的第二 owner beforeEach，后续 owner则可以依赖前序的本次结果。

## 为什么 owner 仍可同时有 template 与 setup

template 名、image digest 或受管 manifest 只证明启动输入，不证明运行事实。
template owner 仍可能需要检查版本、权限、PATH、动态库、service 健康或运行期配置。

若删除 template owner setup，预装优化就会被错误解释成条件证明。
因此 PLAN-9 的 stack 不是“一份 template 加剩下两个 owner”；它是“一份 template 加两个 owner 的 Case/Attempt command，再接 Agent”。

## Provider 负责构建与启动

active template 的 factory 同时选择 Provider；它可以来自 Eval，也可以来自 Experiment。Provider 负责把这份 template 规划成完整 Case，并拥有 build、start、ready、能力句柄、证据、留存与整组 finalizer。

因此 Terminal-Bench Experiment 不声明 sandbox：Compose Eval 自己带 Docker Compose Provider，E2B Eval 自己带 E2B Provider。MemoryBench 则由 Experiment 的 E2B template 带出 Provider，Eval 不关心运行位置。

普通 recipe command 只取得主 Sandbox。
它不能新增 sidecar、改变网络或 volume 拓扑，也不能把运行状态保存成一个未声明的新 template。

## Identity

fingerprint 只能在 Provider 只读 physical / network planning 完成后计算。完整 Attempt identity 包含：

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

```text
windowStackIdentity = hash(owner + phase + ordinal + commandIdentity
                           for setup and teardown)
attemptStackIdentity = hash(owner + phase + ordinal + commandIdentity
                            for beforeEach and afterEach)
caseScopeRecipeIdentity := windowStackIdentity

attemptFingerprint = hash(template physical identity + templateOwner
                          + Provider revision + CaseKey + ownerOrder
                          + windowStackIdentity + attemptStackIdentity
                          + Eval + Experiment + Agent + input identities)
```

`caseScopeRecipeIdentity` 不是第三套独立摘要；它必须精确等于 `windowStackIdentity`。Attempt fingerprint 同时包含 Window 与 Attempt 两套 stack identity，不能只记录本次 beforeEach / afterEach 而漏掉建立 reset anchor 的 setup / teardown。

`commandIdentity` 只能来自 `command()` / `shell()` 的纯数据效果投影，或 `defineSandboxCommand()` 显式登记的 helper id / revision / effective inputs。直接传入的 callback 无法证明闭包输入，一律 opaque。teardown 必须进入 pool key，因为已打开窗口只能绑定一套确定的最终收尾；beforeEach / afterEach 只进入 Attempt fingerprint。

template 物理实现相同但 owner 不同时，ownerOrder 可能不同，因此 fingerprint 也必须不同。
Runner 不从 shell 内容推导 Requirement 或软件 identity。任一 phase 出现 opaque command 都令 `carryEligible = false`。

若 opaque command 属于 setup 或 teardown，Runner 还必须注入：

```text
opaqueWindowSalt = hash(runInvocationId + experimentId + evalId)
windowStackIdentity = hash(declaredWindowStack + opaqueWindowSalt)
```

因此 opaque Window 不会跨 invocation 或 Eval × Experiment pair 命中同一 pool key。opaque Attempt command 不改变 pool key，但仍禁用整条 Attempt 的跨 Run carry。两种情况都在 dry plan 与运行记录显示具体原因。

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

## 不合并 template

普通 recipe command 只能在 active template 启动的主 Sandbox 上执行。若 Eval template 与 Experiment command 无法按 ownerOrder 现场组合，该 pair 就不兼容；PLAN-9 不提供第三个 pair override、第二份 base image 或 provider override 来伪装合并。

作者只能让恰好一侧改用已经包含所需条件的完整 template，另一侧保留 command-only recipe，并通过 Experiment selector 形成合法 pair。预装仍不吞掉运行时检查：template owner 与另一 owner 的 setup / beforeEach 都照常执行。

## 记录与 dry plan

`--dry` 对每条 Eval 展示唯一 template 的 factory / identity / source、templateOwner、由它选出的 Provider、Planned Case 分支、ownerOrder，以及按 Window/Attempt scope 分组的 command 与执行频次。

运行记录保存同一形状，再附每个 owner command 的 scope、activity、facts、耗时与失败 phase。

`runCommand` / `runShell` 使用 checked 语义：非零退出的 exit code、stdout / stderr 证据照常落盘，并立即成为当前 phase 的失败。`tryCommand` / `tryShell` 保存同样的执行证据和显式 try 模式，但仅把非零 exit 结果交给 callback 判断，并把证据标为 `accepted` / `handled`，不污染 failed-command 判据。timeout、cancel 与 transport failure 仍然抛出；try 不会隐藏 command、从 identity 中删除它，或吞掉 callback 随后抛出的错误。

Window scope command 的证据和诊断归 RunningSandboxCase / 复用窗口记录，所有借用它的 Attempt 引用该记录；Attempt scope command 则归当前 Attempt。Runner 不把窗口 setup 或窗口末尾 teardown 虚构成某一条 Attempt 的 hook。

动态本地上传与 Agent 可见 closure 继续执行泄漏比对。
首次运行只能事后拒绝泄漏结果；需要保密时仍使用物理隔离或 filtered context。

## 错误语义

| 失败点 | 结果 |
|---|---|
| 两方都有显式 template | `sandbox.template-conflict`，聚合全部 pair，零 Sandbox 创建 |
| 两方都无 template | `sandbox.template-missing`，聚合全部 pair，零 Sandbox 创建 |
| Direct Agent 搭配任一 SandboxRecipe | `sandbox.unexpected-for-direct-agent`，零 Sandbox 创建 |
| selector 匹配零 Eval | 配置错误；除非显式 `allowEmpty`，零 Sandbox 创建 |
| Provider 目标平台不可用，或 Planned Case 缺少 Agent 所需 capability | physical planning 聚合错误，Adapter 不得暗换 template，零 Sandbox 创建 |
| Compose / Dockerfile / workspaceService、image、E2B template 或 snapshot locator 无效 | physical planning 聚合错误，零 Sandbox 创建 |
| build、start、ready 或资源组失效 | Attempt `errored`，归 Sandbox Case |
| Eval / Experiment recipe setup | 当前窗口不可用，归 `sandbox.setup.eval` / `sandbox.setup.experiment` |
| Eval / Experiment recipe beforeEach | 当前 Attempt `errored`，归 `sandbox.beforeEach.eval` / `sandbox.beforeEach.experiment` |
| Agent Ensure 或 setup | Attempt `errored`，归 `agent.setup` |
| State load/save | Attempt `errored`，归独立 state phase |
| afterEach / teardown | 保留原始结果并记录对应 cleanup phase 诊断 |
| 动态泄漏比对 | Attempt `errored`，不接受 verdict |

任一 setup 失败后不再进入后续 owner，也不开始任何 Attempt；Runner 按已进入 owner 的逆序执行 teardown，最后始终调用 Provider Case finalizer。
beforeEach 失败时 Agent 不开始执行；Runner 对已进入的 Attempt scope 执行逆序 afterEach，并在允许再次借出窗口前验证或恢复 reset 边界。cleanup 诊断不覆盖原始错误。
