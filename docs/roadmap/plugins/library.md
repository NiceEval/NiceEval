# Plugins —— Library

## 完整作者 API

`definePlugin()` 定义一个可复用 family。`define(options)` 在调用 factory 时只执行一次，返回值立即完成 JSON 校验、品牌校验、深冻结；link 不重新调用作者 callback。

```ts
interface PluginDefinition<Options, Attachments extends PluginAttachments> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly define: (options: Options) => {
    readonly instanceKey?: string;
    readonly attachments: Attachments;
  };
}

interface PluginAttachments {
  readonly eval?: EvalPluginContributions;
  readonly experiment?: PluginExperimentContributions;
}

interface EvalPluginContributions {
  readonly behavior?: Readonly<Record<string, JsonValue>>;
  readonly requirements?: readonly PluginRequirement[];
  readonly sandbox?: SandboxLayer<"command-only">;
}

interface PluginExperimentContributions extends EvalPluginContributions {
  readonly flags?: Readonly<Record<string, JsonValue>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly lifecycle?: PluginExperimentLifecycle;
  readonly agentExtensions?: readonly AgentExtension[];
}

interface PluginFamily<Options, Attachments extends PluginAttachments> {
  (options: Options): Plugin<Attachments>;
}

declare function definePlugin<Options, Attachments extends PluginAttachments>(
  definition: PluginDefinition<Options, Attachments>,
): PluginFamily<Options, Attachments>;
```

`defineEval()` 与 `defineScoreEval()` 只接受带 `attachments.eval` 的 Plugin；`defineExperiment()` 只接受带 `attachments.experiment` 的 Plugin。错误挂载既是 TypeScript 错误，动态 JS 边界也会报 definition error。一个 family 可以同时提供两个 attachment，但每侧贡献仍分别受上面的窄类型约束。

Eval attachment 不能贡献 flags、labels、Eval metadata、静态 facts、AgentExtension 或 host lifecycle。Experiment attachment 才能额外贡献 Experiment 级条件身份、生命周期与 Agent 扩展。

## 完整 Remem 定义

```ts
import { definePlugin } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import { rememCodexExtension } from "./remem-codex-extension.ts";

interface RememOptions {
  readonly memoryModel: string;
  readonly mode?: "accumulated" | "isolated";
  readonly instanceKey?: string;
}

export const REMEM_DOCKER_CONTEXT = new URL("./docker/", import.meta.url);

export const remem = definePlugin({
  name: "remem",
  behaviorRevision: "1",
  define(options: RememOptions) {
    const mode = options.mode ?? "accumulated";
    return {
      instanceKey: options.instanceKey,
      attachments: {
        experiment: {
          behavior: { mode },
          flags: { memory: "remem" },
          requirements: rememRequirements(mode),
          sandbox: sandboxLayer().prepare(rememPrepare()),
          agentExtensions: [
            rememCodexExtension({
              memoryModel: options.memoryModel,
              auth: "effective-agent-runtime",
              postSetup: rememInstallAndVerify(),
              preTeardown: rememDrainAndVerify(),
            }),
          ],
        },
      },
    };
  },
});
```

`memoryModel` 只由 Codex receiver 的 canonical behavior projection 进入 hash；Plugin 不在 `behavior` 或 flag 中重复登记。receiver manifest projection 可以保留可读模型值。`REMEM_DOCKER_CONTEXT` 是 package 静态资产定位，不是 Plugin contribution；发布包必须包含 `docker/remem.Dockerfile`。

## 完整 pnpm Plugin

```ts
import { definePlugin } from "niceeval";
import { command, sandboxLayer } from "niceeval/sandbox";

interface PnpmOptions {
  readonly version: string;
}

export const pnpm = definePlugin({
  name: "pnpm",
  behaviorRevision: "1",
  define(options: PnpmOptions) {
    return {
      attachments: {
        eval: {
          behavior: { version: options.version },
          sandbox: sandboxLayer().prepare(
            command("corepack", [
              "prepare",
              `pnpm@${options.version}`,
              "--activate",
            ]),
          ),
          requirements: [
            { stage: "planning", kind: "sandbox-platform", os: "linux" },
          ],
        },
      },
    };
  },
});
```

真实挂载点必须包含消费 owner：

```ts
import { defineEval } from "niceeval";

export default defineEval({
  plugins: [pnpm({ version: "10.15.0" })],
  async test(t) {
    await t.agent("Implement the requested change");
  },
});
```

`yarn({ version })` 是另一个具名 Plugin，拥有自己的版本、安装命令与验收逻辑。两者可以复用 package 内部的私有构造函数，但公共调用面不暴露 `packageManager({ kind })` 这种抹平产品差异的开关。

## 产品调用矩阵

```ts
// MemoryBench：实验条件、Codex extension、Sandbox 探测与整场语义
defineExperiment({
  agent: codexAgent(),
  plugins: [remem({ memoryModel: "gpt-5.6-luna" })],
});

// NiceEval-Eval：候选版本身份与就绪验收
defineExperiment({
  agent: codexAgent(),
  plugins: [candidateRuntime({ version: "0.12.0", runtime: "node" })],
});

// Terminal-Bench：逐 Eval × Experiment pair 的公共 harness 约束
defineExperiment({
  agent: codexAgent(),
  evals: ["terminal-bench/"],
  plugins: [terminalBenchHarness()],
});

// 单题工具链：Eval 自己声明 pnpm
defineEval({
  plugins: [pnpm({ version: "10.15.0" })],
  async test(t) { await t.agent("Implement the requested change"); },
});
```

## 身份与 requirements

默认 `instanceKey` 是 `"default"`。允许多实例的 family 必须要求作者给出不同 key；`(name, instanceKey)` 在整个 Eval × Experiment pair 内唯一，attachment scope 不进入键。

`behavior` 只放改变行为且没有由其它 canonical contribution 表达的 JSON 输入。原 options 和函数体不直接哈希；行为实现变化时提升 `behaviorRevision`。

```ts
type PluginRequirement =
  | { readonly stage: "selection"; readonly kind: "complete-prefix-sequence" }
  | { readonly stage: "selection"; readonly kind: "sandbox-stop-group" }
  | { readonly stage: "link"; readonly kind: "agent-extension-receiver"; readonly receiver: string }
  | { readonly stage: "planning"; readonly kind: "requested-lifetime-at-least"; readonly milliseconds: number }
  | { readonly stage: "planning"; readonly kind: "sandbox-platform"; readonly os: "linux" | "darwin" };
```

Requirement 只读取该阶段已定型的 provider-neutral typed plan。失败在创建资源前聚合，并列出 Plugin identity、attachment owner、pair、所需与实得事实及修正方向。不存在任意 capability string。

## Agent Extension 与槽位冲突

`AgentExtension` 是 receiver-branded opaque value。core 只读取 receiver identity；Adapter receiver 一次规范化作者配置和按顺序排列的 extensions，产生唯一 `behaviorProjection` 与 `manifestProjection`。有效模型、provider 与鉴权复用 Adapter 已求值的同一 runtime binding，Plugin callback 不取得明文。

槽位 owner 统一执行：exclusive 多声明方冲突；keyed 同 key 同规范化值去重并保留 provenance、不同值冲突；ordered 按确定顺序追加；set-like 是否去重由该槽位 owner 决定。没有 last-wins。

## Hook Reference

Plugin 不发明 `beforeAll`、`beforeEach` 一类平行时间轴。它把行为接入下面三组既有 hook：

### Experiment host hooks

```ts
interface PluginExperimentLifecycle {
  readonly setup?: (context: ExperimentHookContext) => void | Promise<void>;
  readonly teardown?: (context: ExperimentHookContext) => void | Promise<void>;
}

interface ExperimentHookContext {
  readonly experimentId: string;
  readonly selectedEvalIds: readonly string[];
  readonly signal: AbortSignal;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  fact(key: string, value: string | number | boolean): void;
}
```

`setup` 在该 Experiment 第一个真实 Attempt 起飞前整场至多一次；全部结果 carry 时不执行。`teardown` 在该 Experiment 的 Attempt 和 Sandbox 全部收口后逆序执行，中断和 setup 部分失败也会尽力调用。适合隧道、mock server、license lease 或整场一次的候选资源，不适合逐题安装工具。

### Physical Sandbox hooks 与 Attempt prepare

```ts
const layer = sandboxLayer()
  .setup(async (sandbox, context) => {
    context.fact("tool.cache", "ready");
  })
  .prepare(command("pnpm", ["--version"]))
  .teardown(async (sandbox, context) => {
    await stopSandboxService(sandbox, context.signal);
  });
```

- `sandbox.setup`：每个实际 physical Sandbox ready 后一次。
- `sandbox.prepare`：每条 Attempt reset 后执行；应先探测，缺失时安装并复检。
- `sandbox.teardown`：physical Sandbox 最后一条 Attempt 收尾后、Provider finalizer 前一次。

Sandbox hook 得到 `Sandbox`、`experimentId`、`signal`、`progress()`、`diagnostic()` 与 `fact()`，拿不到模型、session 或复用池句柄。Plugin 只能贡献 command-only layer，不能借 hook 替换 template。

### Agent receiver hooks

Agent hook 不是 core 的通用字符串槽位，而是具体 Adapter receiver 的 typed API。Remem 的 Codex extension 明确占用：

```ts
rememCodexExtension({
  memoryModel: "gpt-5.6-luna",
  auth: "effective-agent-runtime",
  postSetup: rememInstallAndVerify(),
  preTeardown: rememDrainAndVerify(),
});
```

- `postSetup`：Agent ensure 与 Adapter setup 后、首次 send 前，每条 Attempt 一次。
- `preTeardown`：最后一次 send 后、Agent teardown 前，每条 Attempt一次。

其它 Adapter 可以公开不同的 typed extension，但必须映射到它已经拥有的配置、安装、setup 或 teardown 槽位。core 不提供任意 hook 名注册，也不把有效鉴权明文交给 callback。

## 除了 hook 还能贡献什么

| Contribution | 是否是 hook | 作用 |
|---|---:|---|
| `behavior` | 否 | 声明尚未由其它 owner 表达的行为身份，进入对应 hash |
| `requirements` | 否 | 在 selection、link 或 planning 拒绝不合法完成态计划 |
| `sandbox.prepare(command)` | 否 | 声明可展示、可排序、可指纹化的安装或探测命令 |
| `flags` / `labels` | 否 | Experiment 条件身份与报告分组 |
| `agentExtensions` | 部分 | 同时可贡献 Adapter 配置、安装项、MCP/native plugin 与具名 hook |
| framework manifest | 否 | 自动保存 Plugin identity、attachment、owner、贡献摘要与 provenance |
