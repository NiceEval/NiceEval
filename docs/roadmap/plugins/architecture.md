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

框架写版本化 `niceeval.plugin-provenance/v1`，而不是修改 Record Core。Run 与 Attempt 各有一个
owner-specific exact document；它们不是同一份 payload 在 reader 时按字段猜 owner：

```ts
type PluginProvenanceTextV1 = string;

type PluginProvenanceSourceV1 = {
  readonly kind: "plugins-array";
  readonly position: number;
};

type PluginBehaviorIdentityValueV1 = string | number | boolean | null;

type PluginBehaviorIdentityItemV1 = {
  readonly key: PluginProvenanceTextV1;
  readonly value: PluginBehaviorIdentityValueV1;
};

type TypedAttachmentContributionRefV1 = {
  readonly kind: "typed-attachment";
  readonly owner: "run" | "attempt";
  readonly family: {
    readonly name: PluginProvenanceTextV1;
    readonly schemaId: PluginProvenanceTextV1;
  };
};

type EvalOwnerFragmentContributionRefV1 = {
  readonly kind: "owner-fragment";
  readonly owner: "eval";
  readonly field:
    | "requirements"
    | "sandbox-layer"
    | "flags"
    | "labels"
    | "eval-hook";
};

type ExperimentOwnerFragmentContributionRefV1 = {
  readonly kind: "owner-fragment";
  readonly owner: "experiment";
  readonly field:
    | "requirements"
    | "sandbox-layer"
    | "flags"
    | "labels"
    | "experiment-hook";
};

type OwnerFragmentContributionRefV1 =
  | EvalOwnerFragmentContributionRefV1
  | ExperimentOwnerFragmentContributionRefV1;

type ReceiverProjectionContributionRefV1 = {
  readonly kind: "receiver-projection";
  readonly scope: "run" | "attempt";
  readonly receiver: PluginProvenanceTextV1;
  readonly projection: PluginProvenanceTextV1;
};

type PluginContributionRefV1 =
  | TypedAttachmentContributionRefV1
  | OwnerFragmentContributionRefV1
  | ReceiverProjectionContributionRefV1;

type RunPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "run" })
  | ExperimentOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "run" });

type EvalAttemptPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | EvalOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" });

type ExperimentPairPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | ExperimentOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" });

type PluginProvenanceBaseV1<ContributionRef extends PluginContributionRefV1> = {
  readonly name: PluginProvenanceTextV1;
  readonly instance: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
  readonly source: PluginProvenanceSourceV1;
  readonly effectiveBehaviorIdentity: readonly PluginBehaviorIdentityItemV1[];
  readonly contributionRefs: readonly ContributionRef[];
  readonly credential?: {
    readonly kind: "redacted";
    readonly domain: PluginProvenanceTextV1;
    readonly revision: PluginProvenanceTextV1;
  };
};

type RunPluginProvenanceEntryV1 =
  PluginProvenanceBaseV1<RunPluginContributionRefV1> & {
    readonly mount: "experiment";
  };

type AttemptPluginProvenanceEntryV1 =
  | (PluginProvenanceBaseV1<EvalAttemptPluginContributionRefV1> & {
      readonly mount: "eval";
      readonly subject: "eval" | "pair";
    })
  | (PluginProvenanceBaseV1<ExperimentPairPluginContributionRefV1> & {
      readonly mount: "experiment";
      readonly subject: "pair";
    });

type RunPluginProvenanceV1 = {
  readonly scope: "run";
  readonly entries: readonly RunPluginProvenanceEntryV1[];
};

type AttemptPluginProvenanceV1 = {
  readonly scope: "attempt";
  readonly entries: readonly AttemptPluginProvenanceEntryV1[];
};
```

所有以上 object 都 exact decode，未列字段即 invalid。Record owner 选择 exact document：Run definition 只解码
`RunPluginProvenanceV1`，Attempt definition 只解码 `AttemptPluginProvenanceV1`；`scope` 与实际 owner 不一致即 invalid。

编码边界如下：

- 所有 text 都是 1–128 code points、NFC、无控制字符的 normalized identifier；`name` 另须是 reverse-domain lowercase ASCII namespace。
- `position` 是 non-negative integer；entries 按 `position` 严格递增，`(name, instance)` 不重复。
- 每个 entry 最多有 64 个 identity items 和 64 个 contribution refs；identity items 按 key 规范排序且不重复。
- `effectiveBehaviorIdentity` 只包含安全、规范化后确实影响行为的 scalar 值；secret、private config、credential value、default selector 与 receiver opaque payload 不进入它。
- 需要表示 credential 行为代次时，只保存 redacted `{ domain, revision }` token。

Run-owned document 只允许真正被整份 Run 共享的 Experiment mount。Attempt-owned document 保存对应 Eval 或 pair
事实；Experiment mount 只有在事实依 pair 而变时才可出现在它的 `subject: "pair"` entry。Group 不写
`niceeval.plugin-provenance/v1`：它只参与 selected demand cohort 与 plan manifest，不能借一个 group row 把 slot、
pair、provider、template 或 cohort 提升成 Run-wide 事实。

每个 owner 的一个 attachment family 至多出现一次。`niceeval.plugin-provenance/v1` 是 framework package-private
definition；Plugin 自己声明的 family 也遵守同一限制。duplicate family identity 或 duplicate owner write 是 typed
conflict，即使 payload 字节相同。

## 声明的 attachment write grant

blueprint 的 `recordAttachments.write` 是其唯一的 Record write grant 声明。link 按中立
[producer write grant](../record-attachment-authoring/library.md#producer-write-grant) 为每个 linked occurrence 建立独立
grant，并把 exact opaque definition object 与 mount、owner、occurrence identity 绑定。runtime context 只能消费这个
occurrence grant 中的 definition；它看不到 owner-wide 合并 allowlist，也不能接收 name、schemaId、路径或 raw JSON。

两个 occurrences 声明相同 `(owner, name)` 时，即使 definition object 不同，link 也在资源创建前失败。grant membership
用 exact object identity；durable 与 duplicate identity 则用 owner/name，这两个判断不能互相替代。

Eval lifecycle 只能在其 Attempt 尚未封口时写 Attempt owner；Experiment lifecycle 只能在 Run 尚未封口时写 Run owner。Group 没有 runtime write context。closed、wrong-owner、undeclared 与 duplicate 都是具名 failure，既不改写已有 Attachment，也不退回开放持久化存储。

## Hash、manifest 与 contribution refs

Experiment attachment 的行为进入 Run `configHash`；Eval attachment 的行为只进入对应 Eval fingerprint / manifest，不令同一 Experiment 的 configHash 随 Eval 分叉。每个 hash 输入有同源 manifest 投影；同一个值不以 options、Plugin identity、flag 或 receiver projection 多次登记。

Plugin provenance 的 `contributionRefs` 只由框架在 generic writer 完整写入 attachment 后发出的 accepted event，或在
owner fragment / receiver projection 被 link 接受后 mint。attachment 的调用、reservation、payload capture 与局部 blob
写入都不是 accepted contribution。它的上下文不可混用：

- Run entry 只能引用 Run attachment、Experiment fragment 或 Run receiver projection。
- Eval Attempt entry 只能引用 Attempt attachment、Eval fragment 或 Attempt receiver projection。
- Experiment pair entry 只能引用 Attempt attachment、Experiment fragment 或 Attempt receiver projection。

它没有 raw path、blob ref、payload 或任意 JSON 形态，也不能作为未声明 capability 的写入凭据。它只是对已接受
contribution 的有界审计索引，不是第二份 payload 或绕过 owner-local closure 的引用表。

framework 在 external Plugin grants 关闭并 drain 后聚合这些 events。随后它使用 package-private official
definition、显式 built-in write grant 与同一个 owner context 写 `niceeval.plugin-provenance`。

这条路径不直接操作 draft，不走 Plugin sink，也不把 provenance 自己的 accepted event 递归收回本次 document。
公共面只导出 typed reader / projector；official definition 不公开，以免外部 producer 伪造 framework provenance。

requirements 本身进入 manifest；它验证的 completed plan 依所属 owner 进入 identity。credential value 与默认 selector 不进 hash；显式 credential revision 才表达行为代次。

## 显式 migration registry

Plugin Attachment definition 自己拥有全部版本、相邻 converter 与 unavailable edge。应用通过 config 显式安装
`recordAttachments.install` 中的整份 definition；registry 以 owner、name 与 schema identity 去重，不接收外部 edge。

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
