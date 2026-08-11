# Plugins —— Library

## 作者 API：直接返回现有 owner 片段

Plugin family 声明允许挂载的 owner。callback 直接返回 NiceEval 已有的公开类型，不使用 `attachments` 路由树，也不再发明 `sandbox.prepare()`、`experiment.flag()` 一类 contribution constructor：

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

interface PluginDefinition<Options> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey?: (options: Options) => string;
  readonly eval?: (options: Options) => EvalPluginFragment;
  readonly experiment?: (options: Options) => ExperimentPluginFragment;
  readonly group?: (options: Options) => GroupPluginFragment;
}

type AtLeastOneOwner<Options> =
  | { readonly eval: (options: Options) => EvalPluginFragment }
  | { readonly experiment: (options: Options) => ExperimentPluginFragment }
  | { readonly group: (options: Options) => GroupPluginFragment };

declare function definePlugin<
  Options,
  const Definition extends PluginDefinition<Options> & AtLeastOneOwner<Options>,
>(
  definition: Definition & PluginDefinition<Options> & AtLeastOneOwner<Options>,
): PluginFamily<
  Options,
  SupportedOwners<Definition>,
  FragmentScopes<Definition>
>;
```

`definePlugin()` 保留 callback 的 literal keys 与 fragment type-state。至少要声明一个 owner；callback 是否存在决定 family 可以放进 `defineEval()`、`defineScoreEval()`、`defineExperiment()` 或 `defineSandboxGroup()`。错误挂载既是 TypeScript 错误，动态 JS 边界也会报 definition error。

调用 family 时，NiceEval 立即执行纯 callback，规范化并深冻结 Plugin instance。link 不重新调用作者 callback。Plugin 只组合现有执行对象；它不是另一套 lifecycle DSL。

Group 是选择与调度 owner，不是运行资源。`group()` 没有 setup / teardown、Sandbox layer 或 Agent extension。

## pnpm 与 Yarn

```ts
import { definePlugin } from "niceeval/plugin";
import { command, sandboxLayer } from "niceeval/sandbox";

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

export default defineEval({
  plugins: [pnpm({ version: "10.15.0" })],
  async test(t) {
    await t.agent("Implement the requested change");
  },
});
```

这里的 `.prepare()` 是现有 `SandboxLayer` API，不是 Plugin wrapper。`yarn({ version })` 是另一个具名 Plugin，拥有自己的安装、探测与版本规则；公共 API 不暴露 `packageManager({ kind })`。

## Remem

```ts
export const REMEM_DOCKER_CONTEXT = new URL("./docker/", import.meta.url);

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

`rememPrepare()` 本身就是 `SandboxCommand`，直接进入现有 layer。`memoryModel` 只由 Codex receiver 的 canonical behavior projection 进入 hash。调用点继续显式声明 `dockerImage({ context: REMEM_DOCKER_CONTEXT, ... })`；Plugin 不取得 Sandbox template 所有权。

## 真实生命周期字段

- Eval `before` / `after`：直接使用 `EvalHook`，每条 Attempt 包围 test body。
- Experiment `setup` / `teardown`：直接使用 `ExperimentHook`，每场至多一次。
- Sandbox `prepare` / `setup` / `teardown`：直接构造现有 command-only `SandboxLayer`。
- `agentExtensions`：直接放 receiver-branded `AgentExtension`。

作者不返回 phase 名、hook 注册表或任意字符串 capability。既有 hook context 继续提供 `AbortSignal`、`progress()`、`diagnostic()` 与 `fact()`。

## Git repository Plugin

Git 产品 API 把 repository identity 与每题 checkout 分开：

```ts
const upstream = gitRepository({
  repo: "https://github.com/downshift-js/downshift.git",
  into: ".",
  instanceKey: "upstream",
});

export default defineEval({
  plugins: [upstream.checkout({ commit: BASE_COMMIT })],
  async test(t) {
    await t.agent("修复当前问题");
  },
});
```

fresh Sandbox 的 cohort 只有当前 pair；reuse 时 Runner 自动聚合同一实例将服务的 selected pair demands。`defineSandboxGroup()` 不重复声明 repositories。

Git 是 V1 唯一需要 cohort aggregate 的官方 Plugin。`gitRepository().checkout()` 返回带私有 nominal brand 的 Eval Plugin instance；通用 Plugin 作者看不到 `sandbox.resource()` 或 receiver factory。core 只保存不透明 demand、聚合投影与 provenance，不读取 repo、commit 或路径。

官方 Git receiver 在 fingerprint 前聚合 demands，在 physical Sandbox 创建后 materialize seed，并把当前 checkout 作为原生 prepare command 放在该 Plugin 的 SandboxLayer 位置。它拥有四类错误：`demand-invalid`、`demand-unsatisfied`、`instance-unavailable` 与 `attempt-consume-failed`。

## Requirements、identity 与冲突

Requirement 是封闭 typed union，表达以下计划约束：

- reuse group、stop-group 与 complete-prefix；
- platform、requested lifetime 与 resources；
- runtime profile、Docker access 与 ordered sequence。

Plugin 只把 union 值直接放进 `requirements` 数组。

默认 `instanceKey` 是 `"default"`。`(name, instanceKey)` 在一个 attachment owner 内唯一；同一 Eval × Experiment pair 两侧出现同 identity 是 link error。provenance 保存 owner、源码与数组位置。

每个 owner 内先接作者原生片段，再按 `plugins[]` 顺序接 Plugin 原生片段。exclusive 多声明方冲突；keyed 同 key 同规范化值去重并保留 provenance，不同值冲突；ordered 按确定顺序追加。没有 last-wins。

## Hash、manifest 与 secret

framework 自动写入 `name`、`behaviorRevision`、`instanceKey`、owner 与 provenance。`identity` 只登记没有被 flags、requirements、Sandbox command 或 receiver projection 表达的行为输入；同一输入不重复登记。

`AgentExtension` 继续由 Adapter receiver 规范化，core 不读取 payload。有效 provider、model 与鉴权复用 Adapter 已求值的 runtime binding；Plugin callback 不取得 secret 明文。
