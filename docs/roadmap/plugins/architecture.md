# Plugins —— Architecture

## 从 blueprint 到 LinkedAgentPlan

```text
Agent factory extensions ───────────────┐
Experiment plugins[].agentExtensions ──┴─▶ RunAgentPlan / run projection
                                               │
Eval plugins[].agentExtensions ────────────────┴─▶ pair delta
                                                       │
                                                       ▼
                                                LinkedAgentPlan
                                      provision / configure / lifecycle / dispose
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

Agent 特殊性留在 Adapter receiver。core 只收 nominal `AgentExtension`、receiver identity、不可变 Agent、安全 projection 与分阶段计划；它不读取 Codex config、MCP、native Plugin、Hook 或 credential payload。

## AgentExtension protocol 与 receiver

`defineAgentExtensionProtocol()` 创建 opaque token。receiver 必须显式列出接受的 token object；兼容性、`oneOfAgentExtensions()` 选择与 payload 路由都只认对象身份，不认展示字符串。token 的 reverse-domain `name + revision` 只用于安全展示、诊断与 canonical projection。

同一 linked plan 中，两个不同 token object 声明相同展示 identity 时返回 `protocol-token-collision`。这通常表示重复依赖或 protocol 版本分裂；link 不用 `Symbol.for`、全局 registry、动态注册或字符串匹配猜测两者兼容。Plugin 必须直接从 Adapter 包导入 protocol factory，或通过 peer dependency 共享 token。

每个 Agent factory 绑定一个 receiver。receiver identity 同样是 reverse-domain `name + revision`，并进入 Run identity；`resolve`、merge、provision、materialize、redaction 或 cleanup 语义变化都必须提升 revision。第三方 Adapter 可以导出自己的 protocol factory 与 receiver，无需修改 core 或注册全局名字。

`oneOfAgentExtensions()` 是封闭 choice node，不是 fallback：

1. definition 阶段拒绝相同 token 的重复 branch；
2. link 只按 selected receiver 的静态 support 选择；
3. 零匹配列出所有 unsupported reason，多匹配报 ambiguity；
4. 恰好一个 branch 后才校验 payload 与参与 merge；
5. 选中 branch 的 validation、merge 或 materialization 失败不会回退。

共享 Skill／MCP protocol 由多个 receiver 直接接受，不需要 choice。

## 两层身份归属

Agent base config 与 Experiment Plugin contribution 形成 `RunAgentPlan`；其 receiver identity、canonical behavior projection 与已 snapshot 的资产 digest 进入 Run `configHash`：

```text
run configHash = H(existing Run config, receiver identity, RunAgentProjection)
```

Eval Plugin 只能在 Run plan 上形成 `PairAgentDelta`。pair fingerprint 已经包含 `configHash`，因此只新增 canonical delta，不能重复编码 Run projection：

```text
pair fingerprint = H(existing pair inputs, run configHash, PairAgentDelta)
```

Eval contribution 与 Run 中既有 keyed value 完全相同时，只增加 provenance，canonical delta 为零；异值形成 pair link conflict。影响 provisioning 的 Eval extension 仍属于 pair delta，不得反向改变 Agent identity 或 Run projection。同一 Experiment 的 `configHash` 因而不会随 Eval 分叉。

每个 hash input 都有同源、安全、确定性的 manifest projection。opaque payload、secret value、env selector、宿主绝对路径和未规范化 options 不进入 hash；同一个行为输入也不以 Plugin identity、flag 与 receiver projection 重复登记。

## 单一真源与合并

Agent factory 的 `extensions` 与 Plugin fragment 的 `agentExtensions` 使用同一种 protocol value。base Agent 是第一 contributor，Experiment Plugin 按声明顺序接入 Run plan，Eval Plugin 最后叠加 pair delta。旧 factory 字段 `skills`、`mcpServers`、`plugins`、`postSetup`、`preTeardown` 不再保留为另一套真源。

receiver 拥有每个窄 slot 的 canonicalizer 与合并规则：

| slot | key | 规则 |
|---|---|---|
| Skill | 安装名 | 同 canonical source 去重并保留 provenance，异值冲突。 |
| MCP server | server name | transport、公开配置与 credential selector 联合相等才去重，异值冲突。 |
| native Plugin／Python extension | native id／package key | 同精确内容 identity 去重，异值冲突。 |
| credential binding | receiver-defined target slot | 安全 projection 与私有 selector 都相等才去重，异值冲突。 |
| Agent-native Hook | ordered occurrence | 保持 contributor 顺序，由 Agent runtime 执行。 |
| Agent lifecycle command | ordered occurrence | 保持 contributor 顺序，由 receiver 执行 `StableSandboxCommand`。 |
| Hosted Agent Hook | ordered occurrence | 保持 contributor 顺序，由 NiceEval host 执行 callback。 |

完整 Codex TOML／Claude JSON 是 Agent factory 独占的 base slot，保留原始字节。Plugin 不能提交 arbitrary native-config patch、generic env map、deep merge 或改写 Adapter-owned 保留键。主 credential、model 与 provider 也没有 extension slot。

## 完整 desired state 与 managed overlay

receiver 的纯 `resolve` 产出不可变 `LinkedAgentPlan`，至少拆成：

- `provision / ensure`：把 CLI、Bub Python package 等安装条件编入本 Attempt 的 ensure plan；
- `configure`：根据完整 desired state 创建 receiver-owned managed overlay；
- `afterConfigure`：完整配置与 Agent runtime ready 后执行稳定命令；
- `beforeAgentTeardown`：执行仍需配置存在的 drain／flush／verify；
- `dispose`：Agent teardown 后由 receiver 撤销 overlay，不开放 Plugin callback。

Sandbox reuse 下，每个 Attempt 必须从本次完整 desired state 收敛，不能在上一个 pair 上增量叠加。receiver 使用自己的 ledger／overlay 或隔离 Agent home，并且只能删除 NiceEval 管理的旧项；空 desired state 也要移除上一 Attempt 的受管 Skill、MCP、Plugin、Hook 与 credential materialization。无法证明隔离或可撤销的 extension 声明 reuse unsupported，由 typed requirement 在创建资源前拒绝。replacement Sandbox 必须重新 materialize。

## Asset、secret 与信任边界

Plugin activation 只快照 `pluginAsset()` 的 `file:` locator，不做 I/O。pure link 完成 branch／slot 检查后，selected planning snapshot 才读取本地 asset，拒绝根 symlink、目录内 symlink 与 special file，并计算 digest。V1 materialize 只消费已经捕获的 snapshot，不重读宿主路径。identity、Record、dry plan 与错误展示只出现逻辑用途、kind 和 digest，不出现宿主绝对路径。

远程安装内容必须声明完整 commit identity 或 content digest；floating branch、movable tag 与默认 ref 在 link 阶段失败。dry 不下载远程内容，materialize 后核验。MCP HTTP endpoint 是运行时服务，不属于安装 asset。

`credentialFromEnv()` 在 factory／link／dry 中保持 opaque；所有 selected binding 在任何 extension 写入前一次性求值。安全 projection 只含目标 slot、domain、可选 revision 与 render。env selector 与 value 不进入 identity、provenance 或 dry plan，但私有 merge 仍比较 selector，避免两个不同 secret selector 被错误去重。

Plugin、第三方 protocol factory 与 receiver 都是 application-trusted ESM code。nominal token 防止误接线，不形成 JavaScript sandbox；core 无法证明第三方 receiver 没把 secret 写入自己的错误或 projection。NiceEval 只为内建 receiver 承诺 redaction、纯 `resolve` 与资源纪律，不提供 marketplace 自动发现、按 Record 动态 import 或恶意代码隔离。

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
    | "hosted-agent-hooks";
};

type ExperimentRunFragmentContributionRefV1 = {
  readonly kind: "owner-fragment";
  readonly owner: "experiment";
  readonly field:
    | "flags"
    | "labels"
    | "experiment-hook";
};

type ExperimentPairFragmentContributionRefV1 = {
  readonly kind: "owner-fragment";
  readonly owner: "experiment";
  readonly field:
    | "requirements"
    | "sandbox-layer"
    | "hosted-agent-hooks";
};

type OwnerFragmentContributionRefV1 =
  | EvalOwnerFragmentContributionRefV1
  | ExperimentRunFragmentContributionRefV1
  | ExperimentPairFragmentContributionRefV1;

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
  | ExperimentRunFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "run" });

type EvalAttemptPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | EvalOwnerFragmentContributionRefV1
  | (ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" });

type ExperimentPairPluginContributionRefV1 =
  | (TypedAttachmentContributionRefV1 & { readonly owner: "attempt" })
  | ExperimentPairFragmentContributionRefV1
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
    readonly revision?: PluginProvenanceTextV1;
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

`niceeval.plugin-provenance/v1` 是 framework package-private definition。Plugin 不声明
Attachment family，也不能执行 owner write。

## 没有 attachment write grant

Plugin blueprint 不接受 Record definition、write grant 或 migration registry，runtime context
也不接触 draft。旧方案已经[退役](../record-attachment-authoring/README.md)。未来高层能力必须
独立建模，不能以 name、schemaId、path、raw JSON 或内部 owner context 作为扩展面。

## Hash、manifest 与 contribution refs

Experiment attachment、fragment 与 Agent extension 的 Run-owned 行为进入 Run `configHash`。Eval contribution 只进入对应 pair fingerprint／manifest，不令同一 Experiment 的 `configHash` 随 Eval 分叉。

Agent extension 使用前文 `RunAgentProjection + PairAgentDelta` 的两层投影。pair fingerprint 不重复登记已经包含在 `configHash` 内的 Run 值。每个 hash input 有配套 manifest 投影；同一个值不以 options、Plugin identity、flag 或 receiver projection 多次登记。

Plugin provenance 的 `contributionRefs` 只由框架在 owner fragment / receiver projection
被 link 接受后 mint。它的上下文不可混用：

- Run entry 只能引用 Run attachment、Experiment flags／labels／Run lifecycle 或 Run receiver projection。
- Eval Attempt entry 只能引用 Attempt attachment、Eval fragment 或 Attempt receiver projection。
- Experiment pair entry 只能引用 Attempt attachment、Experiment requirement／Sandbox layer／Hosted Hook 或 Attempt receiver projection。

Hosted Hook 总是 Attempt-local，不得出现在 Run entry。反过来，Experiment flags、labels 与每 Run 一次的 `setup`／`teardown` 不得伪装成 pair-local ref。

它没有 raw path、blob ref、payload 或任意 JSON 形态，也不能作为未声明 capability 的写入凭据。它只是对已接受
contribution 的有界审计索引，不是第二份 payload 或绕过 owner-local closure 的引用表。

framework 在 Plugin lifecycle drain 后聚合这些 events。随后它使用 package-private official
definition 与内部 owner context 写 `niceeval.plugin-provenance`。

这条路径不直接操作 draft，不走 Plugin sink，也不把 provenance 自己的 accepted event 递归收回本次 document。
公共面只导出 Report 所需的 opaque projector；official definition 不公开，以免外部 producer 伪造 framework provenance。

requirements 本身进入 manifest；它验证的 completed plan 依所属 owner 进入 identity。credential value 与默认 selector 不进 hash；显式 credential revision 才表达行为代次。

## migration registry 不向 Plugin 开放

`niceeval migrate` 只遍历 NiceEval 内部 registry。它不从 Record bytes 推断 package 名并
import Plugin，也不调用 factory、requirements、hook、receiver lifecycle 或 runtime binding。

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
