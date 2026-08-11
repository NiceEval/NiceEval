# Plugins —— Architecture

## 从定义到 pair

```text
Eval plugins[] ─────────┐
                       ├─ pair link ─▶ requirements / Sandbox chain / fingerprint
Experiment plugins[] ──┘                 │
                                         └─ Agent extensions / Run lifecycle
```

Plugin factory 调用产生不可变 blueprint。link 为每个 attachment occurrence 建立私有 Linked Plugin Instance；blueprint 与模块闭包不得保存运行时 mutable state。Experiment lifecycle occurrence 每 Run 至多 setup 一次，不因多个 Eval pair 重复执行。

`(name, instanceKey)` 在整个 pair 内唯一，scope 不进入键。Eval 与 Experiment 同时挂同一 identity 不是去重机会，而是 link error。provenance 保存 `eval | experiment | group`、owner id/source 与数组位置。

## Template owner 决定 Sandbox 顺序

每个 owner 内始终是 author 原生片段后接该 owner 的 `plugins[]` 原生片段。跨 owner 顺序由 template owner 决定：

```text
Eval owns template:
Eval author → Eval plugins → Experiment author → Experiment plugins → Agent

Experiment owns template:
Experiment author → Experiment plugins → Eval author → Eval plugins → Agent
```

Plugin 只能返回 command-only `SandboxLayer`，不能改变 template owner 或提供 template。所有冲突在创建外部资源前聚合；相同 keyed 值可去重但保留两份 provenance，不同值报错。

## Core 与 Agent receiver

Agent 特殊性留在 Adapter。core 只收集 receiver-branded opaque `AgentExtension`、检查 receiver identity、接收 receiver 返回的不可变 Agent、canonical behavior projection 与 manifest projection。core 不读取 Codex config、MCP、native plugin、hook 或鉴权 payload。

Remem 使用 Adapter 已求值的 effective runtime auth / provider binding；受管 transport 在最后边界注入并登记脱敏。不存在把 secret 字符串返回 Plugin callback 的通用函数。

## Hash、manifest 与事实

Experiment attachment 的行为进入 Run 级 `configHash`；Eval attachment 的行为只进入对应 Eval fingerprint / manifest，不使同一 Experiment 的 configHash 因 Eval 分叉。

```ts
interface LinkedPluginInfo {
  readonly name: string;
  readonly instanceKey: string;
  readonly behaviorRevision: string;
  readonly attachment: "eval" | "experiment" | "group";
  readonly owner: { readonly id: string; readonly source: string; readonly position: number };
  readonly fragment: JsonValue;
}
```

- `identity` 只保存没有被其它 canonical 原生字段表达的执行输入。
- Agent 行为只由 receiver behavior projection 表达。
- flags 进入 Experiment 行为；labels 不进入 hash。
- requirements 本身进入 manifest；它验证的完成态 plan 按所属契约进入 hash。
- framework 自动写入规范化原生片段与 provenance；Plugin 不提供任意静态 facts。
- runtime facts 只能经既有 `ctx.fact()` / `ctx.facts()` 通道产生。
- credential value 和默认 selector 不进 hash；显式 credential revision 才表达行为代次。

每个 hash 输入有同源 manifest 投影，同一个值不以 options、Plugin behavior、flag 与 receiver projection 多次登记。

## Requirement 证据与强杀恢复

Experiment 静态 Plugin 摘要属于 Run manifest；Eval attachment 与每个 pair 的 requirement 实得事实属于逐 Eval fingerprint / plan manifest。provider、Sequence、stop-group 与 requested lifetime 的 pair 事实不能提升成整份 Run 的共同事实。

需要跨进程补做的 Experiment teardown 登记有序 Linked Plugin behavior identities。恢复时只有 identity 完整匹配才执行当前组合 teardown；删除、重排、升级或配置变化时保留义务并给出人工方向。Attempt 与 physical Sandbox 继续使用既有 Scope，不另建 Plugin registry。

## Demand cohort 与 Sandbox resource

pair link 之后、carry planning 之前，Runner 为每个预计的 physical Sandbox 形成 selected demand cohort：

```text
fresh Sandbox     → 当前单 pair
Experiment sandboxReuse: true → 本 Invocation 中共用该实例的冻结 selected pairs
Sandbox reuse group → 冻结选择命中的组内 pair
```

cohort 不随逐 Eval carry 重判缩减。全 carry 不创建资源；只要至少一条 Attempt 真实派发，就把全部 selected demands 交给对应 opaque receiver。attempt 数量不复制 demand。

core 按 nominal protocol token 分桶，一次传入同 token 的 demand 与 provenance。receiver 拥有 seed key 合并、冲突验证和 canonical aggregate projection。hash envelope 同时登记 receiver name、revision 与 projection。Runner 把 envelope 写入 cohort 每个 pair 的 fingerprint 与 manifest，因此共享成员变化会诚实作废其它成员的 carry。

`sandboxReuse: true` 的 cohort 在 carry 前按本 Invocation 中会进入同一 reuse key 的 selected pairs 冻结；可携带 Attempt 不会在冻结后删去 demand。Sandbox Group 只拥有成员集合、selected cohort、串行队列、实例编号和 `stop-group | replace-sandbox`。它不是 resource lifetime scope，也没有 Plugin group runtime handle。资源 handle 属于 physical Sandbox instance；replacement 必须重新 materialize。

不同 receiver 的副作用是否冲突不由 core 根据路径或 payload 猜测。需要跨 protocol claim 协议时必须由新的具名用例另行定稿。
