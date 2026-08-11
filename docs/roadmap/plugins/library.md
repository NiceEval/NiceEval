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
            }),
          ],
        },
      },
    };
  },
});
```

`memoryModel` 只由 Codex receiver 的 canonical behavior projection 进入 hash；Plugin 不在 `behavior` 或 flag 中重复登记。receiver manifest projection 可以保留可读模型值。`REMEM_DOCKER_CONTEXT` 是 package 静态资产定位，不是 Plugin contribution；发布包必须包含 `docker/remem.Dockerfile`。

## 完整 Eval-safe Plugin

```ts
import { definePlugin } from "niceeval";
import { command, sandboxLayer } from "niceeval/sandbox";

interface WorkspaceContractOptions {
  readonly packageManager: "npm" | "pnpm" | "yarn";
}

export const workspaceContract = definePlugin({
  name: "workspace-contract",
  behaviorRevision: "1",
  define(options: WorkspaceContractOptions) {
    return {
      attachments: {
        eval: {
          behavior: { packageManager: options.packageManager },
          sandbox: sandboxLayer().prepare(
            command(options.packageManager, ["--version"]),
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
  plugins: [workspaceContract({ packageManager: "pnpm" })],
  async test(t) {
    await t.agent("Implement the requested change");
  },
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
