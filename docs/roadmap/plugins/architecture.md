# Plugins —— Architecture

## 从 blueprint 到 pair

```text
Eval plugins[] ─────────┐
                       ├─ pair link ─▶ requirements / chain / identity
Experiment plugins[] ──┘                 │
                                         └─ receiver extension / lifecycle / typed writes
```

Plugin factory 产生不可变 blueprint。link 为每个 attachment occurrence 建立私有 Linked Plugin Instance；blueprint 与模块闭包不得保存运行时 mutable state。Experiment lifecycle occurrence 每 Run 至多执行一次，不因多个 Eval pair 重复执行。

`(name, instance)` 在整个 pair 内唯一，mount 不进入这个键。Eval 与 Experiment 同时挂载同一 identity 是 link error。错误保留 mount、owner、source 与数组位置，而不让任一侧替代另一侧。

## Template owner 与现有执行面

每个 owner 内始终是作者原生片段后接 `plugins[]` 片段。跨 owner 顺序由 template owner 决定：

```text
Eval owns template:
Eval author → Eval plugins → Experiment author → Experiment plugins → Agent

Experiment owns template:
Experiment author → Experiment plugins → Eval author → Eval plugins → Agent
```

Plugin 只能返回 command-only `SandboxLayer`，不能改变 template owner 或提供 template。exclusive、keyed 与 ordered contribution 都在资源创建前规范化；冲突不采用 last-wins。

Agent 特殊性留在 Adapter receiver。core 只收 receiver-branded opaque `AgentExtension`、receiver identity、不可变 Agent 与规范化 behavior projection。core 不读取 Codex config、MCP、native plugin、hook 或鉴权 payload。

## Plugin provenance Attachment

框架写版本化 `niceeval.plugin-provenance/v1`，而不是修改 Record Core：

```ts
type PluginProvenanceEntryV1 = {
  readonly name: string;
  readonly instance: string;
  readonly revision: string;
  readonly mount: "eval" | "experiment" | "group";
  readonly source: { readonly id: string; readonly position: number };
  readonly effectiveBehaviorIdentity: JsonValue;
  readonly contributionRefs: readonly PluginContributionRefV1[];
  readonly credential?: {
    readonly kind: "redacted";
    readonly domain: string;
    readonly revision: string;
  };
};
```

`effectiveBehaviorIdentity` 是安全、规范化后确实影响行为的值。secret、private config、credential value、default selector 与 receiver opaque payload 不进入它；需要表示 credential 行为代次时，只保存 redacted `{ domain, revision }` token。

Run-owned provenance 只包含整份 Run 共享的 Experiment mount。Eval mount、group selection、provider、template、slot、pair 或 cohort 的事实写入正确的 Attempt Attachment 或 pair plan manifest。它们不能仅因同一个 Plugin 名字就被提升成 Run-wide facts。

每个 owner 的一个 attachment family 至多出现一次。`niceeval.plugin-provenance/v1` 是框架拥有的 family；Plugin 自己声明的 family 也遵守同一限制。duplicate family identity 或 duplicate owner write 是 typed conflict，即使 payload 字节相同。

## 声明的 attachment capability

blueprint 的 `recordAttachments` 是其唯一的 Record 写权限根。link 将声明的 capability 与允许的 mount、owner 绑定；runtime context 只能消费这个 opaque token 和对应的 typed write。它不能接收 name、schemaId、路径或 raw JSON。

Eval lifecycle 只能在其 Attempt 尚未封口时写 Attempt owner；Experiment lifecycle 只能在 Run 尚未封口时写 Run owner。Group 没有 runtime write context。closed、wrong-owner、undeclared 与 duplicate 都是具名 failure，既不改写已有 Attachment，也不退回开放持久化存储。

## Hash、manifest 与 contribution refs

Experiment attachment 的行为进入 Run `configHash`；Eval attachment 的行为只进入对应 Eval fingerprint / manifest，不令同一 Experiment 的 configHash 随 Eval 分叉。每个 hash 输入有同源 manifest 投影；同一个值不以 options、Plugin identity、flag 或 receiver projection 多次登记。

Plugin provenance 的 `contributionRefs` 只引用已被 generic writer 接受的 typed attachment、原生 contribution 或 receiver projection。它不是第二份 payload，也不变成能绕过 owner-local closure 的引用表。

requirements 本身进入 manifest；它验证的 completed plan 依所属 owner 进入 identity。credential value 与默认 selector 不进 hash；显式 credential revision 才表达行为代次。

## 显式 migration registry

Plugin Attachment family、相邻 converter 与 unavailable edge 由应用显式加入 migration registry / Layer。registry 以 owner、name、schema identity 和 edge 为键，拒绝 duplicate、分叉、跳过版本或不相邻 converter。

`niceeval migrate` 只遍历此时提供的 registry。它不从 Record bytes 推断 package 名并 import Plugin，也不调用 factory、requirements、hook、receiver lifecycle 或 runtime binding。converter 是 trusted extension：`Effect` 的 requirement 为 `never` 只限制依赖注入，并不构成 JavaScript sandbox。

## Demand cohort 与 Sandbox resource

pair link 后、carry planning 前，Runner 为每个预计 physical Sandbox 形成 selected demand cohort：

```text
fresh Sandbox     → 当前单 pair
Experiment reuse  → 同一实例的冻结 selected pairs
Sandbox group     → 冻结选择命中的组内 pair
```

cohort 不随逐 Eval carry 重判缩减。全 carry 不创建资源；只要有一条 Attempt 真实派发，receiver 就接到完整 selected demand。attempt 数量不复制 demand。

core 按 nominal protocol token 分桶，一次传入同 token 的 demand 与 provenance。receiver 拥有 seed key 合并、冲突验证和 canonical aggregate projection。Runner 把该 projection 写入 cohort 每个 pair 的 fingerprint 与 manifest，因此共享成员变化会诚实作废其它成员的 carry。

`sandboxReuse: true` 的 cohort 在 carry 前冻结。Sandbox Group 只拥有成员集合、selected cohort、串行队列、实例编号和 `stop-group | replace-sandbox`；资源 handle 属于 physical Sandbox instance，replacement 必须重新 materialize。
