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

## 声明 occurrence-local write grant

每个 Plugin 要写 Record 时，先在 blueprint 中列出
[RecordAttachment producer write grant](../record-attachment-authoring/library.md#producer-write-grant)。`write` 引用一个
完整、多版本 definition，而不是携带 name、schemaId、文件路径或外部 migration edge：

```ts
export const candidateRuntime = definePlugin({
  name: "candidate-runtime",
  behaviorRevision: "1",
  recordAttachments: {
    write: [candidateRuntimeObservation],
  },
  experiment(options: CandidateRuntimeOptions) {
    return { identity: { version: options.version } };
  },
});
```

blueprint 的 `recordAttachments.write` 为每个 linked occurrence 形成独立 grant，不是 application migration registry，
也不自动写入。
Plugin 的 `behaviorRevision` 与 existing identity 继续描述 producer 行为；current Attachment presence requirement
由 reuse contract 另行声明。两个 occurrence 即使引用不同 definition objects，只要 `(owner, name)` 相同，link 也在
创建资源前返回带双方 provenance 的 typed conflict。

## runtime write context

已 link 的 lifecycle context 直接组合中立 owner-local `record()`；不存在 `PluginRecordContext` 或 Plugin writer：

```ts
const candidateRuntime = definePlugin({
  name: "candidate-runtime",
  behaviorRevision: "1",
  recordAttachments: { write: [candidateRuntimeObservation] },
  experiment() {
    return {
      async teardown(ctx) {
        const version = await probeCandidateRuntime();
        await ctx.record(candidateRuntimeObservation, {
          version,
        });
      },
    };
  },
});
```

`ctx.record()` 的 direct payload、blob builder、eager reservation、tracked command 与错误联合以中立
[Library](../record-attachment-authoring/library.md#owner-local-record-context) 为单源。Plugin 不包装第二种 write，
也不增加 `plugin-record-*` 平行错误词表。只有 generic writer 完整成功后形成的 accepted event 才能进入 framework
provenance；调用、reserve 或局部 blob 写入都不是成功 contribution。

| mount | 可写 owner | 封口边界 |
|---|---|---|
| Eval `before` / `after` | 当前 Attempt | Attempt 的 Record draft 封口前。 |
| Experiment `setup` / `teardown` | 当前 Run | Run 的 Record draft 封口前。 |
| Group | 无 | Group 没有 runtime context。 |

wrong-owner 与 undeclared 在 TypeScript 入口尽量不可表达；动态 JavaScript、类型断言、duplicate 或错误时序仍得到
中立 RecordAttachment command failure。没有开放 JSON 回退入口。

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

Plugin package 导出自己的完整 definition；应用通过
`defineConfig({ recordAttachments: { install: [definition] } })` 安装并信任它。family-owned edge、converter、blob target、
`R = never` 与 Git 恢复点以中立 [Library](../record-attachment-authoring/library.md) 和
[CLI](../record-attachment-authoring/cli.md) 为单源。

Plugin blueprint 的 `write` grant 不隐式安装 migration。删除 Plugin producer 后，应用可以只保留 definition import
与 config registration；`niceeval migrate` 不运行 factory、hook、lifecycle 或 receiver。
