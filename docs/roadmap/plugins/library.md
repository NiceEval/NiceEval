# Plugins —— Library

## 作者 API：返回既有 owner 片段

Plugin family 声明允许挂载的 owner。callback 返回 NiceEval 已有公开类型；它不构造 raw Attachment 路由，也不发明第二套 Sandbox 或 lifecycle DSL。

```ts
interface EvalPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly PluginRequirement[];
  readonly sandbox?: SandboxLayer<"command-only", SandboxLayerScope>;
  readonly before?: EvalHook;
  readonly after?: EvalHook;
}

interface ExperimentPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly PluginRequirement[];
  readonly flags?: Readonly<Record<string, JsonValue>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly sandbox?: SandboxLayer<"command-only", SandboxLayerScope>;
  readonly setup?: ExperimentHook;
  readonly teardown?: ExperimentHook;
  readonly agentExtensions?: readonly AgentExtension[];
}

interface GroupPluginFragment {
  readonly identity?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly GroupRequirement[];
  readonly manifest?: JsonValue;
}
```

`definePlugin()` 保留 callback 的 literal keys 与 fragment type-state。至少声明一个 owner；缺少相应 callback 的 family 不能挂到 `defineEval()`、`defineScoreEval()`、`defineExperiment()` 或 `defineSandboxGroup()`。动态 JavaScript 在 definition 边界收到同样的具名错误。

调用 family 时，NiceEval 立即执行纯 callback，规范化并深冻结 Plugin instance。link 不重新调用 callback。Group 是选择与调度 owner，不是运行资源，所以没有 setup、teardown、Sandbox layer、Agent extension 或 runtime Record write。

## 声明 typed RecordAttachment capability

每个 Plugin 要写 Record 时，先在 blueprint 中列出 capability。它引用已定义的 family，而不是携带 name、schemaId 或文件路径字符串：

```ts
import { Effect, Schema } from "effect";

interface PluginAttachmentCapability<
  Owner extends "run" | "attempt",
  Payload,
> {
  readonly owner: Owner;
  readonly family: RecordAttachmentFamily<Owner, Payload>;
}

declare function declarePluginAttachment<
  const Owner extends "run" | "attempt",
  S extends Schema.Schema.AnyNoContext,
>(input: {
  readonly family: RecordAttachmentFamily<Owner, Schema.Schema.Type<S>>;
}): PluginAttachmentCapability<Owner, Schema.Schema.Type<S>>;
```

`Schema.Schema.AnyNoContext` 与 `Schema.Schema.Type<S>` 是 Effect 3.22.1 的实际类型名。family 已经拥有 exact JSON encoder、decoder、owner 与相邻 migration policy；Plugin 不重复定义它们。

```ts
const candidateRuntimeObservation = declarePluginAttachment({
  family: CandidateRuntimeObservationFamily,
});

export const candidateRuntime = definePlugin({
  name: "candidate-runtime",
  behaviorRevision: "1",
  recordAttachments: [candidateRuntimeObservation],
  experiment(options: CandidateRuntimeOptions) {
    return { identity: { version: options.version } };
  },
});
```

blueprint 的 `recordAttachments` 是 allowlist，不是自动写入。一个 owner 的同一 family 只能声明一次；link 对重复 capability identity 返回 typed conflict，即使两个 declaration 的内容相同。

## runtime write context

已 link 的 lifecycle context 提供窄 `record()` 能力：

```ts
interface PluginRecordContext<Owner extends "run" | "attempt"> {
  readonly record: <Payload, E, R>(
    capability: PluginAttachmentCapability<Owner, Payload>,
    write: RecordAttachmentWrite<Owner, E, R>,
  ) => Effect.Effect<void, PluginRecordAttachmentWriteError | E, R>;
}

type PluginRecordAttachmentWriteError =
  | { readonly code: "plugin-record-closed" }
  | { readonly code: "plugin-record-wrong-owner" }
  | { readonly code: "plugin-record-attachment-undeclared" }
  | { readonly code: "plugin-record-attachment-duplicate" };
```

`write` 只能由 capability family 的 typed attachment builder 产生，payload 与 `Schema.Schema.Type<S>` 同源。`record()` 以 builder 捕获的 family 与 capability 的 family 做 exact-identity 比较；`RecordAttachmentWrite` 的泛型保留 blob stream 的 `E` / `R`，并原样传出。`record()` 没有 raw name、path、schemaId 或 `unknown` / JSON 参数；它自己的 failure 也只暴露 opaque capability 与 owner 语义，不泄露 payload 或路径。

| mount | 可写 owner | 封口边界 |
|---|---|---|
| Eval `before` / `after` | 当前 Attempt | Attempt 的 Record draft 封口前。 |
| Experiment `setup` / `teardown` | 当前 Run | Run 的 Record draft 封口前。 |
| Group | 无 | Group 没有 runtime context。 |

wrong-owner、undeclared、duplicate 与 closed 在 TypeScript 入口尽量不可表达；JavaScript、类型断言或错误时序仍得到上表的 typed failure。没有开放 JSON 回退入口。

## pnpm 与 Yarn

```ts
export const pnpm = definePlugin({
  name: "pnpm",
  behaviorRevision: "1",
  eval(options: { version: string }) {
    return {
      identity: { version: options.version },
      sandbox: sandboxLayer().prepare(command("corepack", [
        "prepare",
        `pnpm@${options.version}`,
        "--activate",
      ])),
    };
  },
});
```

这里的 `.prepare()` 是既有 `SandboxLayer` API，不是 Plugin wrapper。`yarn({ version })` 是另一个具名 Plugin，拥有自己的安装、探测与版本规则；公共 API 不用 `packageManager({ kind })` 抹平它们。

## Remem 与 receiver

```ts
export const remem = definePlugin({
  name: "remem",
  behaviorRevision: "1",
  experiment(options: RememOptions) {
    const mode = options.mode ?? "accumulated";
    return {
      identity: { mode },
      flags: { memory: "remem" },
      requirements: rememRequirements(mode),
      sandbox: sandboxLayer().prepare(rememPrepare()),
      agentExtensions: [rememCodexExtension({
        memoryModel: options.memoryModel,
        auth: "effective-agent-runtime",
        postSetup: rememInstallAndVerify(),
        preTeardown: rememDrainAndVerify(),
      })],
    };
  },
});
```

`memoryModel` 只由 Codex receiver 的 canonical behavior projection 进入 hash。有效 provider、model 与鉴权复用 Adapter 已求值 runtime binding；Plugin callback 不取得 secret 明文。需要保留运行观测时，Remem 必须声明对应 typed Attachment family。

## Requirements、identity 与冲突

Requirement 是封闭 typed union。它可表达：

- reuse group、stop-group 与 complete-prefix；
- platform、requested lifetime 与 resources；
- runtime profile、Docker access 与 ordered sequence。

Plugin 只把 union 值放进 `requirements`，不能暗改对应计划。

默认 `instance` 是 `"default"`。`(name, instance)` 在 pair 内唯一，且同一 owner + attachment family 至多一次。每个 owner 先接作者原生片段，再按 Plugin 顺序接贡献：exclusive 冲突，keyed 同值去重并保留 provenance，keyed 异值冲突，ordered 确定追加。

framework 自动写入 provenance entry，其中有 name、instance、revision、mount、source、规范化行为 identity 与 contribution refs。
identity 只登记不能由 flags、requirements、Sandbox command 或 receiver projection 表达的行为输入；同一输入不重复登记。

## migration registry / Layer

应用通过显式 `PluginAttachmentMigrationRegistry` Layer 提供它信任的 families。每个 family 必须登记 current definition 和每条相邻 edge：converter 或 `not-losslessly-migratable`。registry 拒绝同一 owner/name/schema identity 或 edge 的 duplicate registration。

converter 的形状是：

```ts
type PluginAttachmentConverter<
  Owner extends "run" | "attempt",
  From,
  To,
> = (
  source: RecordAttachmentValue<From>,
  target: RecordAttachmentMigrationTarget<Owner, To>,
) => Effect.Effect<
  RecordAttachmentWrite<Owner, PluginAttachmentMigrationFailure, never>,
  PluginAttachmentMigrationFailure,
  never
>;
```

converter 通过 `target` builder mint target refs 和 bytes，不能交回 raw JSON、旧 ref 或路径。`R = never` 不允许依赖 NiceEval service；它不是第三方 JavaScript 的安全隔离。`niceeval migrate` 只消费显式 Layer，绝不根据保存数据 import package，也绝不运行 factory、hook、lifecycle 或 receiver。
