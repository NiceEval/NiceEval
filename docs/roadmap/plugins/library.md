# Plugins —— Library

## 作者 API：按 owner 写，不写路由树

Plugin family 直接声明允许挂载的 owner。作者不接触 `attachments.eval.sandbox` 一类内部路由对象：

```ts
interface PluginDefinition<Options> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey?: (options: Options) => string;
  readonly eval?: (options: Options) => readonly EvalContribution[];
  readonly experiment?: (options: Options) => readonly ExperimentContribution[];
  readonly group?: (options: Options) => readonly GroupContribution[];
}

type AtLeastOneOwner<Options> =
  | { readonly eval: (options: Options) => readonly EvalContribution[] }
  | { readonly experiment: (options: Options) => readonly ExperimentContribution[] }
  | { readonly group: (options: Options) => readonly GroupContribution[] };

declare function definePlugin<
  Options,
  const Definition extends PluginDefinition<Options> & AtLeastOneOwner<Options>,
>(
  definition: Definition & PluginDefinition<Options> & AtLeastOneOwner<Options>,
): PluginFamily<Options, SupportedOwners<Definition>>;
```

调用 family 时，NiceEval 立即执行这些纯 callback，校验 contribution 品牌与 JSON 投影并深冻结 Plugin instance。link 不重新调用作者 callback。callback 是否存在同时决定类型能力：

- 只有 `eval()`：可放进 `defineEval()` / `defineScoreEval()`；
- 只有 `experiment()`：可放进 `defineExperiment()`；
- 只有 `group()`：可放进 `defineSandboxGroup()`；
- 同时声明多个 callback：同一 family 可以在对应 owner 使用，但一次 Plugin occurrence 仍只属于调用点 owner。

错误挂载既是 TypeScript 错误，动态 JS 边界也会报 definition error。

## Contribution constructors

callback 返回带品牌的 contribution 列表。namespace 表达实际 owner 或资源作用域，不是可拼写的字符串 phase：

```ts
declare const CONTRIBUTION: unique symbol;
type Contribution<Kind extends string, Value> = Readonly<{
  [CONTRIBUTION]: Kind;
  value: Value;
}>;
type BehaviorValue = Readonly<Record<string, JsonValue>>;
type PluginRequirement =
  | { readonly stage: "selection"; readonly kind: "sandbox-reuse-group" }
  | { readonly stage: "selection"; readonly kind: "stop-group" }
  | { readonly stage: "selection"; readonly kind: "complete-prefix" }
  | { readonly stage: "planning"; readonly kind: "sandbox-platform"; readonly platform: "linux/amd64" | "linux/arm64" }
  | { readonly stage: "planning"; readonly kind: "sandbox-lifetime"; readonly minimumMs: number }
  | { readonly stage: "planning"; readonly kind: "sandbox-resources"; readonly minimum: { readonly cpu: number; readonly memoryMiB: number } }
  | { readonly stage: "planning"; readonly kind: "runtime-profile"; readonly profile: "node" | "python" | "system" }
  | { readonly stage: "planning"; readonly kind: "docker-access"; readonly access: "daemon" | "rootless" }
  | { readonly stage: "planning"; readonly kind: "ordered-sequence" };
type GroupRequirement = Extract<
  PluginRequirement,
  { readonly stage: "selection" | "planning" }
>;
type EvalAroundHook = Readonly<{
  before?: EvalHook;
  after?: EvalHook;
}>;

type EvalContribution =
  | Contribution<"plugin.behavior", BehaviorValue>
  | Contribution<"plugin.require", PluginRequirement>
  | Contribution<"eval.around", EvalAroundHook>
  | Contribution<"sandbox.prepare", SandboxCommand>
  | Contribution<"sandbox.setup", SandboxHook>
  | Contribution<"sandbox.teardown", SandboxHook>
  | Contribution<"sandbox.resource", SandboxResourceDemand>;

type ExperimentContribution =
  | Exclude<EvalContribution, Contribution<"eval.around", EvalAroundHook>>
  | Contribution<"experiment.flag", readonly [string, JsonValue]>
  | Contribution<"experiment.label", readonly [string, string | number]>
  | Contribution<"experiment.setup", ExperimentHook>
  | Contribution<"experiment.teardown", ExperimentHook>
  | Contribution<"agent.extend", AgentExtension>;

type GroupContribution =
  | Contribution<"plugin.behavior", BehaviorValue>
  | Contribution<"group.require", GroupRequirement>
  | Contribution<"group.manifest", JsonValue>;

plugin.behavior(value: BehaviorValue);
plugin.require(requirement);

eval.around(hooks: EvalAroundHook);

experiment.flag(key, value);
experiment.label(key, value: string | number);
experiment.setup(hook);
experiment.teardown(hook);

sandbox.prepare(command);
sandbox.setup(hook);
sandbox.teardown(hook);
sandbox.resource(demand);

agent.extend(extension);

group.require(requirement);
group.manifest(value);
```

这些调用均是前述 union 的穷尽 constructor 签名；参数与返回的 `kind`、`value` 一一对应。`sandbox.*` 可以从 Eval 或 Experiment callback 返回；实际 layer owner 就是挂载 Plugin 的 definition。`agent.extend()`、`experiment.*` 只能从 `experiment()` 返回。`eval.around()` 只能从 `eval()` 返回。

每个具名 constructor 都有精确的 `Contribution<kind, value>` 返回类型；它们不是可伪造的 `{ kind, value }` 对象。

Group 是选择与调度 owner，不是能跨 Sandbox replacement 存活的运行资源。因此 V1 没有 `group.setup()` / `group.teardown()`。`group()` 只能贡献静态 behavior、typed requirement 与 manifest。resource demand 来自组内 Eval / Experiment pair；运行资源必须使用 `sandbox.resource()`，其 lifetime 是 physical Sandbox instance。

## pnpm 与 Yarn

```ts
import { definePlugin, plugin, sandbox } from "niceeval/plugin";
import { command } from "niceeval/sandbox";

export const pnpm = definePlugin({
  name: "pnpm",
  behaviorRevision: "1",
  eval(options: { version: string }) {
    return [
      plugin.behavior({ version: options.version }),
      sandbox.prepare(command("corepack", [
        "prepare",
        `pnpm@${options.version}`,
        "--activate",
      ])),
    ];
  },
});
```

消费方只有产品调用：

```ts
export default defineEval({
  plugins: [pnpm({ version: "10.15.0" })],
  async test(t) {
    await t.agent("Implement the requested change");
  },
});
```

`yarn({ version })` 是另一个具名 Plugin，拥有自己的安装、探测与版本规则。两者可以复用 package 私有构造函数，但公共 API 不暴露 `packageManager({ kind })`。

## Remem

```ts
export const REMEM_DOCKER_CONTEXT = new URL("./docker/", import.meta.url);

export const remem = definePlugin({
  name: "remem",
  behaviorRevision: "1",
  experiment(options: RememOptions) {
    const mode = options.mode ?? "accumulated";
    return [
      plugin.behavior({ mode }),
      experiment.flag("memory", "remem"),
      ...rememRequirements(mode).map(plugin.require),
      sandbox.prepare(rememPrepare()),
      agent.extend(rememCodexExtension({
        memoryModel: options.memoryModel,
        auth: "effective-agent-runtime",
        postSetup: rememInstallAndVerify(),
        preTeardown: rememDrainAndVerify(),
      })),
    ];
  },
});
```

`memoryModel` 只由 Codex receiver 的 canonical behavior projection 进入 hash。`REMEM_DOCKER_CONTEXT` 是 package 静态资产定位，不是 Plugin contribution；调用点继续显式声明 `dockerImage({ context: REMEM_DOCKER_CONTEXT, ... })`。

## Git repository Plugin

Git 产品 API 把 seed identity 与每题 demand 分开：

```ts
const upstream = gitRepository({
  repo: "https://github.com/downshift-js/downshift.git",
  into: ".",
  instanceKey: "upstream",
});

export default defineEval({
  plugins: [
    upstream.checkout({
      commit: "1111111111111111111111111111111111111111",
    }),
  ],
  async test(t) {
    await t.agent("修复当前问题");
  },
});
```

不复用 factory 时可以内联：

```ts
plugins: [gitRepository({ repo, into: "." }).checkout({ commit })]
```

`checkout()` 返回 Eval-attachable Plugin。fresh Sandbox 的 cohort 只有当前 pair，因此正常 clone；Eval 加入 reuse group 后，Runner 自动聚合同一实例将服务的 selected pair demands。`defineSandboxGroup()` 不重复声明 repositories。

其内部定义仍使用相同作者 API：

```ts
const gitCheckoutPlugin = definePlugin({
  name: "git-repository",
  behaviorRevision: "1",
  instanceKey: (options: GitCheckoutOptions) => options.instanceKey,
  eval(options: GitCheckoutOptions) {
    const demand = gitReceiver.demand(options);
    return [
      sandbox.resource(demand),
      sandbox.prepare(gitReceiver.prepare(demand)),
    ];
  },
});
```

## Sandbox resource protocol

Sandbox resource receiver 拥有一类资源协议。它产生的 `SandboxResourceDemand` 是 receiver-branded opaque value；core 只按 receiver identity 分桶并传递 provenance，不读取 Git、commit、路径或其它 payload：

```ts
declare const SANDBOX_RESOURCE_DEMAND: unique symbol;
interface SandboxResourceDemand<Protocol extends symbol = symbol> {
  readonly [SANDBOX_RESOURCE_DEMAND]: Protocol;
}

interface DemandWithProvenance<Protocol extends symbol, Demand> {
  readonly demand: Demand & SandboxResourceDemand<Protocol>;
  readonly owner: LinkedPluginOwner;
}

interface SandboxResourceReceiverDefinition<Options, Protocol extends symbol, Demand, Aggregate, Handle> {
  readonly name: string;
  readonly revision: string;
  createDemand(options: Options): Demand;
  aggregate(input: readonly DemandWithProvenance<Protocol, Demand>[]): Aggregate;
  projection(aggregate: Aggregate): JsonValue;
  materialize(
    sandbox: Sandbox,
    aggregate: Aggregate,
    context: SandboxHookContext,
  ): Promise<Handle>;
  consume(
    sandbox: Sandbox,
    handle: Handle,
    demand: Demand,
    context: SandboxCommandContext,
  ): Promise<void>;
  teardown?(sandbox: Sandbox, handle: Handle): Promise<void>;
  classifyFailure(error: unknown): SandboxResourceFailure;
}

interface SandboxResourceReceiver<Options, Protocol extends symbol, Demand> {
  demand(options: Options): Demand & SandboxResourceDemand<Protocol>;
  prepare(demand: Demand & SandboxResourceDemand<Protocol>): SandboxCommand;
}

declare function defineSandboxResourceReceiver<Options, const Protocol extends symbol, Demand, Aggregate, Handle>(
  protocol: Protocol,
  definition: SandboxResourceReceiverDefinition<Options, Protocol, Demand, Aggregate, Handle>,
): SandboxResourceReceiver<Options, Protocol, Demand>;

type SandboxResourceFailure =
  | { readonly kind: "demand-invalid" }
  | { readonly kind: "demand-unsatisfied" }
  | { readonly kind: "instance-unavailable" }
  | { readonly kind: "attempt-consume-failed" };
```

每个 receiver package 持有一个不导出的 `unique symbol` protocol token，并把它作为 factory 第一参数。结构相同的 receiver 也不能交换 demand；带 provenance 的 aggregate 输入保留同一 `Protocol` 参数。

receiver 自己拥有三层 identity：protocol/receiver identity、可合并的 seed key、per-consumer demand。Git receiver 因此能让同 repo 不同 `into` 共用 seed，同时在零资源阶段拒绝不同 repo 抢同一 `into`。core 不猜不同 protocol 之间的文件副作用冲突。

factory 调用 definition 的 `createDemand()`，再添加只属于返回 receiver 的品牌；作者不能从 definition 伪造 receiver-bound demand。`demand()` 只创建声明值；`prepare()` 把同 receiver 的 demand 变成每 Attempt consumer command。

Runner 才调用 definition 的 runtime `consume(sandbox, handle, demand, context)`。receiver 的唯一 canonical hash 输入是 `projection(aggregate)`：它同时表达 cohort 可见对象与当前 consumer demand，不再另登记 `plugin.behavior()` 或 consumer projection。

## Requirements、identity 与冲突

默认 `instanceKey` 是 `"default"`。`(name, instanceKey)` 在一个 attachment owner 内唯一；同一 Eval × Experiment pair 两侧出现同 identity 仍是 link error。provenance 保存 owner、源码与数组位置。

Requirement 是封闭 typed union，可在 selection、link 或 planning 读取已定型事实。需要 reuse group 的 Plugin 声明 `{ stage: "selection", kind: "sandbox-reuse-group" }`；它不会得到虚构的 group runtime handle。

槽位 owner 统一执行：exclusive 多声明方冲突；keyed 同 key 同规范化值去重并保留 provenance、不同值冲突；ordered 按确定顺序追加；set-like 是否去重由该槽位 owner 决定。没有 last-wins。

## Agent Extension 与 secret

`AgentExtension` 是 receiver-branded opaque value。Adapter receiver 规范化作者配置和 extensions，产生唯一 `behaviorProjection` 与 `manifestProjection`。有效模型、provider 与鉴权复用 Adapter 已求值的同一 runtime binding；Plugin callback 不取得明文。

## Hook Reference

- `experiment.setup/teardown`：每个 Experiment 整场至多一次，管理宿主共享服务。
- `sandbox.setup/teardown`：每个 physical Sandbox instance 一次。
- `sandbox.prepare`：每条 Attempt reset 后执行。
- `eval.around({ before, after })`：每条 Attempt 一次，包围 Eval test body；`after` 在 test 抛错或中断时仍按 finalizer 规则执行。
- Adapter extension hook：例如 Codex `postSetup/preTeardown`，每条 Attempt 一次。

所有 hook 只接入既有正式 phase；Plugin 不注册任意字符串 phase。`progress()`、`diagnostic()`、`fact()` 与 `AbortSignal` 继续由对应既有上下文提供。
