# PLAN-10 —— Architecture

**相关文档**：[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 数据模型

```typescript
type AuthorLayerOwner = "eval" | "experiment";
type LayerOwner = AuthorLayerOwner | "agent";

interface OwnedAuthorLayer {
  readonly owner: AuthorLayerOwner;
  readonly ownerId: string;
  readonly kind: "root" | "extension";
  readonly root?: {
    readonly factory: string;
    readonly template: SandboxTemplate;
    readonly sourceModule: string;
  };
  readonly commands: readonly SandboxCommand[];
  readonly commandIdentity: JsonValue;
}

interface OwnedAgentLayer {
  readonly owner: "agent";
  readonly ownerId: string;
  readonly kind: "extension";
  readonly provisioners: readonly AgentProvisioner[];
  readonly provisionerIdentity: JsonValue;
}

type OrderedSandboxLayers =
  | readonly [
      OwnedAuthorLayer & { readonly owner: "eval"; readonly kind: "root" },
      OwnedAuthorLayer & { readonly owner: "experiment"; readonly kind: "extension" },
      OwnedAgentLayer,
    ]
  | readonly [
      OwnedAuthorLayer & { readonly owner: "experiment"; readonly kind: "root" },
      OwnedAuthorLayer & { readonly owner: "eval"; readonly kind: "extension" },
      OwnedAgentLayer,
    ];

interface LinkedSandboxPair {
  readonly evalId: string;
  readonly experimentId: string;
  readonly rootOwner: AuthorLayerOwner;
  readonly root: SandboxTemplate;
  readonly layers: OrderedSandboxLayers;
}

interface PlannedSandboxPair extends LinkedSandboxPair {
  readonly provider: string;
  readonly plannedCase: PlannedSandboxCase;
  readonly rootPhysicalIdentity: JsonValue;
}
```

`LinkedSandboxPair.layers` 的 tuple 类型在实现中分别精确成：

```text
Eval root       -> [Eval, Experiment, Agent]
Experiment root -> [Experiment, Eval, Agent]
```

公开 `SandboxLayer` 只有 kind 品牌与 command 链。
Provider factory 归一时才把 root template 放进 `OwnedAuthorLayer`；普通作者不能手写这个内部结构。

Agent layer 参与相同的 owner 顺序和 activity 归因，但保留 `AgentProvisioner` 原协议。
统一的是“在哪个位置执行”，不是“所有节点必须长成同一个 callback”。

## SandboxTemplate 与 Sandbox 实例

root layer 内部携带一个封闭的 `SandboxTemplate` 联合：

```typescript
type SandboxTemplate =
  | DockerComposeSandboxTemplate
  | DockerfileSandboxTemplate
  | DockerImageSandboxTemplate
  | E2BSandboxTemplate
  | VercelSnapshotSandboxTemplate
  | CustomSandboxTemplate;
```

每个成员同时选定自己的 Provider planner。
它们只共享“规划成一个完整 Sandbox 实例”的结果，不要求字段同构：

```text
logical root
  -> Provider read-only planner
  -> PlannedSandboxCase
  -> build / start / ready
  -> RunningSandboxCase
  -> primary Sandbox + capabilities + resource-group finalizer
```

Compose template 可以产生多个 service、网络、volume 与能力句柄，但仍是一个 logical root 和一个完整 Case。
因此“pair 恰好一个 root”不限制 Case 内资源数量。

## Pair-local root link

Runner 在 discovery 与 Experiment selector 完成后，为每一条实际边做 XOR link：

| Eval layer | Experiment layer | Root | 固定顺序 |
|---|---|---|---|
| root | extension | Eval | Eval → Experiment → Agent |
| extension | root | Experiment | Experiment → Eval → Agent |
| root | root | `sandbox.root-conflict` | 不生成 |
| extension | extension | `sandbox.root-missing` | 不生成 |

省略 `sandbox` 已经规范化为空 extension，所以不会产生隐式 Provider default。
相同 template identity 的两份 root 仍然冲突：删除其中一份会改变 root owner、命令顺序、source provenance 与失败归因，Runner 不能先去重再猜。

全矩阵 link 是纯过程，不读 Compose 文件、不访问 Provider 网络、不 build，也不创建 Sandbox。
任一 cell 非法时聚合全部错误，并让整个 Run 保持零 Provider I/O 与零资源。

## 一个 Run 可以有多个 root

root 唯一性只约束矩阵单元：

```text
                    Experiment X
                    extension
Eval A Compose root     A
Eval B E2B root         B
Eval C image root       C
```

这里有三个 logical root，但每个 pair 只有一个，所以矩阵合法。
物理 planner 可以按 root identity、Provider revision、平台和 build input 共享构建输出；它不会把三个 root 合并成一个 Case。

反向矩阵同样合法：

```text
                    Experiment CPU root   Experiment GPU root
Eval Q extension          CPU                    GPU
```

同一个 Eval 在两个 pair 中分别运行于不同 root。
Eval 的 command identity 相同不表示 Attempt identity 相同；root physical identity、root owner 与 Experiment identity 都进入 fingerprint。

### 混合矩阵的结构约束

如果一个 Experiment 自己是 root，它选中的每个 Eval 都必须是 extension。
如果一个 Experiment 是 extension，它选中的每个 Eval 都必须是 root。

因此下面的完整乘积不合法：

```text
                    Experiment X extension   Experiment Y root
Eval A root                  valid                  conflict
Eval B extension             missing                 valid
```

PLAN-10 不用优先级把 conflict / missing 变成隐式选择。
作者应让 X 只选择 A、Y 只选择 B，或移动 root 所有权，使每条实际 selector 边都满足 XOR。

如果同一个业务组合确实需要 Eval 条件与 Experiment 条件共同烘焙，唯一 root factory 必须指向已经融合两者的完整 Case；另一方保留 extension layer 来执行实际检查。
共享 fused root 可以用普通 TypeScript 工厂函数，不增加 pair override registry。

### Logical root 与物理 variant

一个 root factory 可以在 physical planning 时根据显式目标平台选用不同 digest：

```text
dockerImageSandbox({ image: "acme/tool:v3" })
  -> linux/amd64 digest A
  -> linux/arm64 digest B
```

这仍是一份 logical root 声明。
planner 必须在 fingerprint 前确定唯一 effective platform 与 locator；不同物理 variant 具有不同 BuildKey / CaseKey，不能在运行到一半才 fallback。

一个 pair 若在 link 时就含有两个独立 logical root，则永远是 conflict；Provider variant 不能成为合并两份 root 的后门。

## 固定 owner 顺序

每条 Attempt 的准备顺序由 root owner 完全决定：

```text
rootOwner = eval
  Eval commands -> Experiment commands -> AgentProvisioners

rootOwner = experiment
  Experiment commands -> Eval commands -> AgentProvisioners
```

每个 author layer 内按 `.prepare()` 的追加顺序串行执行。
多个 AgentProvisioner 按 Adapter 声明顺序串行执行；Agent runtime setup 在全部 provisioner 收敛后开始。

Runner 不从命令文本、路径、包管理器或 Provider 名推导依赖，也不自动并行。
第一期没有 priority、before / after owner、依赖 DAG、资源锁或可重排 phase。

依赖方向是公开契约：

- root command 可以依赖 root template；
- 第二 author layer 可以依赖 root commands；
- AgentProvisioner 可以依赖两方 author commands；
- 前层不能依赖后层尚未产生的结果。

反向依赖必须通过移动 command owner、把条件放进 root，或拆分 pair 消除。
重试等待后层出现不是合法解决方案。

## 单一 Attempt prepare 频次

PLAN-10 的普通 author command 没有 Window scope。
无论 fresh 或 reuse，每条 Attempt 都在进入 Agent 前重新执行两层命令：

```text
fresh: create Case -> author commands -> AgentProvisioners -> Agent
reuse: reset Case  -> author commands -> AgentProvisioners -> Agent
```

因此命令不能依赖“上一条 Attempt 应该已经运行过我”。
昂贵工具由明确的检查命令实现实际 inspect、miss 时 install、安装后 reinspect；预装 root 只让检查命中，不删除 command。

这项选择刻意牺牲 Window-only command 的表达力：

- Case 寿命资源归 Provider Case；
- 外部状态的 open / load / save / close 归 State Feature；
- 不能幂等、严格每复用周期一次的任意 callback 不属于普通 SandboxLayer。

它避免作者在不了解 reset anchor 和 pool key 时选择错误 scope。

## Agent 安装进入同一时间线

Agent Adapter 的 provisioner 节点排在两层 author command 之后。
每条 Attempt 都执行 `inspect -> miss 时 install -> reinspect`；预装 CLI 或复用 Sandbox 通常在 inspect 快速命中。

AgentProvisioner 可以在资源创建前按已经确定的目标平台准备 host payload，并把 payload digest、目标平台与安装模式带入 fingerprint：

```text
link pair
  -> collect AgentProvisioner platform requirements
  -> Provider physical plan
  -> AgentProvisioner prepare(target platform)
  -> fingerprint
  -> create Case
  -> root commands
  -> extension commands
  -> Agent inspect / install / reinspect
```

实际 staged payload 只有在目标 pair 需要时送入主 Sandbox。
普通 author command 不能取得 Agent credential、安装模式或宿主 prepare 入口。

Adapter 不能提供 root 或 Provider。
Agent 需要特殊系统起点时，Eval 或 Experiment 必须显式提供兼容 root；link / physical planning 用 Adapter 声明的 capability requirement 检查它。

## Identity、carry 与复用

完整 Attempt fingerprint 至少包含：

- logical root identity、root owner 与 Provider planner revision；
- physical template locator、BuildKey、CaseKey 与目标平台；
- 固定 layer order；
- 两个 author layer 的 command identity；
- AgentProvisioner identity、payload digest、平台与安装模式；
- Eval、Experiment、Agent、输入与 transfer manifest identity。

同一 Run 中不同 pair 即使使用相同 physical template，也不能省略 owner 与 layer order。

`command()` / `shell()` 和显式登记 inputs 的 `defineSandboxCommand()` 可以参与稳定 fingerprint。
任一直接 callback 为 opaque 时，该 Attempt `carryEligible = false`；Runner 不用函数名或 `Function.prototype.toString()` 猜闭包。

Sandbox reuse 的 pool key 至少固定：

```text
(CaseKey, rootOwner, author layer identities, AgentProvisioner identity)
```

PLAN-10 每条 Attempt 都重新执行 commands，所以 pool key 不把“某条命令已经执行”当作可跳过证据。
reset 失败、prepare cleanup 失败或 State Feature 无法恢复已知边界时退休该复用周期。

## Cleanup 与错误语义

SandboxCommand 只有在取得资源后才通过 `onCleanup()` 注册本次 cleanup。
Runner 按全局准备顺序逆序执行：Agent runtime teardown、第二 author layer cleanup、root layer cleanup，最后在复用周期关闭时调用 Provider Case finalizer。

| 失败点 | 结果 |
|---|---|
| pair 有两个 root | `sandbox.root-conflict`，全矩阵聚合，零 Provider I/O |
| pair 没有 root | `sandbox.root-missing`，全矩阵聚合，零 Provider I/O |
| Direct Agent 搭配 SandboxLayer | `sandbox.unexpected-for-direct-agent` |
| root factory / platform / capability 不可用 | physical planning 聚合错误，零 build / create |
| Provider build / start / ready | Attempt `errored`，归 Sandbox 实例 |
| root author command | Attempt `errored`，归 `sandbox.prepare.<rootOwner>` |
| extension author command | Attempt `errored`，归对应 owner |
| AgentProvisioner inspect / install / reinspect | Attempt `errored`，归 `agent.provision` |
| State load / save | Attempt `errored`，归独立 state phase |
| command cleanup / Agent teardown | 保留原结果并追加 cleanup diagnostic；必要时退休该复用周期 |
| Provider finalizer | 写入 Case cleanup diagnostic，不取代原始 Attempt verdict |
