# Experiment Plugins —— Library

## Experiment 调用面

`plugins` 是有序的 Experiment 条件声明:

```ts
import { defineExperiment } from "niceeval";

export default defineExperiment({
  ...memoryExperimentBase,
  plugins: [
    remem({ memoryModel: "gpt-5.6-luna" }),
    captureMemoryDiagnostics(),
  ],
});
```

```ts
interface ExperimentAuthorFields {
  readonly plugins?: readonly ExperimentPlugin[];
}
```

数组位置决定有序贡献的 setup 顺序,不充当身份。同一 `(name, instanceKey)` 出现两次是 definition error。一个插件 family 确实允许多实例时,每个实例必须给出显式 `instanceKey`;默认 key 是 `"default"`。

## 定义插件 family

`defineExperimentPlugin()` 声明并校验一个可签入、可复用的蓝图 factory,不创建运行时资源:

```ts
import { defineExperimentPlugin } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import { rememCodexExtension } from "./remem-codex-extension.ts";

interface RememOptions {
  readonly memoryModel: string;
  readonly mode?: "accumulated" | "isolated";
  readonly instanceKey?: string;
}

export const remem = defineExperimentPlugin<RememOptions>({
  name: "remem",
  behaviorRevision: "1",
  define(options) {
    const mode = options.mode ?? "accumulated";
    return {
      instanceKey: options.instanceKey,
      behavior: { mode },
      flags: {
        memory: "remem",
        rememMemoryModel: options.memoryModel,
      },
      labels: { memory: "remem" },
      requirements: rememRequirements(mode),
      sandbox: sandboxLayer().prepare(rememPrepare()),
      agentExtensions: [
        rememCodexExtension({
          memoryModel: options.memoryModel,
          auth: "effective-agent-runtime",
        }),
      ],
    };
  },
});
```

公开形状:

```ts
interface ExperimentPluginFamily<Options> {
  (options: Options): ExperimentPlugin;
}

interface ExperimentPluginDefinition<Options> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly define: (options: Options) => ExperimentPluginContributions;
}

interface ExperimentPluginContributions {
  readonly instanceKey?: string;
  readonly behavior?: Readonly<Record<string, JsonValue>>;
  readonly flags?: Readonly<Record<string, JsonValue>>;
  readonly labels?: Readonly<Record<string, string | number>>;
  readonly requirements?: readonly ExperimentPluginRequirement[];
  readonly experiment?: ExperimentPluginLifecycle;
  readonly sandbox?: SandboxLayer<"command-only">;
  readonly agentExtensions?: readonly AgentExtension[];
}

interface ExperimentPluginLifecycle {
  readonly setup?: ExperimentPluginSetup;
  readonly teardown?: ExperimentPluginTeardown;
}

function defineExperimentPlugin<Options>(
  definition: ExperimentPluginDefinition<Options>,
): ExperimentPluginFamily<Options>;
```

`behavior` 只声明会改变插件行为、且没有被其它规范化 contribution 表达的 JSON 输入。原 factory options 不直接哈希;同一个语义值也不在 `behavior`、flags 与 Agent receiver projection 中重复登记。函数体不可稳定哈希,插件行为改变时必须提升 `behaviorRevision`。

`sandbox` 只能是 command-only layer。插件不能提供或装饰 template-bearing layer,也不能修改作者的 provider options。

## Agent Extension

`AgentExtension` 是 receiver-branded opaque value。core 只能读取稳定 receiver identity,不能读取扩展 payload:

```ts
interface AgentExtension<Receiver extends string = string> {
  readonly receiver: Receiver;
  readonly [AGENT_EXTENSION]: true;
}
```

具体 Adapter 提供自己的 extension factory。它可以表达该 Adapter 已有的配置层、安装层、`postSetup` 与 `preTeardown`,但不能把这些合成一个新的运行 phase。

Agent factory 返回的定义值保持不可变。link 时 receiver 收到作者配置和按插件顺序排列的 extensions,一次返回:

```ts
interface AgentExtensionResult {
  readonly agent: Agent;
  readonly behaviorProjection: JsonValue;
  readonly manifestProjection: JsonValue;
}
```

`behaviorProjection` 是 Agent 扩展行为身份的唯一 producer,包含 receiver identity / revision。core 不再哈希原始 AgentExtension payload或插件侧的重复投影。

Remem 需要 Codex 的有效模型、provider 与鉴权时,extension 请求 receiver 的 `effective-agent-runtime` binding。Codex receiver 复用 Adapter 已求值的同一份运行值,在受管 env / argument transport 边界注入;插件 callback 不拿到明文。只有扩展真正需要 Adapter 之外的凭据时,才使用该 receiver 自己定义的额外 credential selector。

## Requirements

Requirement 是封闭、按事实阶段求值的纯 plan guard,不是 callback:

```ts
type ExperimentPluginRequirement =
  | { readonly stage: "selection"; readonly kind: "complete-prefix-sequence" }
  | { readonly stage: "selection"; readonly kind: "sandbox-stop-group" }
  | { readonly stage: "link"; readonly kind: "agent-extension-receiver"; readonly receiver: string }
  | { readonly stage: "planning"; readonly kind: "requested-lifetime-at-least"; readonly milliseconds: number };
```

每一项只读取该阶段已经定型的只读投影。静态 requirement 即使本轮全部结果可以 carry 也要验证;所有失败在创建外部资源前聚合,并列出 plugin identity、Eval × Experiment pair、所需事实、实得事实与修正方向。

Requirement 只拒绝计划,不自动选择 Sequence、不创建 reuse group、不改 `maxConcurrency`、不改 lifetime。Requirement 本身进入 manifest 但不单独进入 config hash;它验证的完成态 plan 继续按所属契约进入既有哈希。

Provider-neutral completed plan 增加 typed `requestedLifetimeMs` 投影,供 `requested-lifetime-at-least` 使用。它只证明作者请求值;Provider 账号是否接受仍由既有 validate / create 失败面负责。

镜像里是否存在 Remem、glibc 或正确版本不抽象成任意 capability string。插件贡献的 `rememPrepare()` 在 `sandbox.prepare.experiment` 实机验证;未来若要在 create 前证明镜像内容,使用独立的 materialization / attestation 契约。

## 槽位冲突

接收每个槽位的 owner 负责规范化,并保留 author / plugin provenance:

| 槽位类型 | 组合规则 |
|---|---|
| exclusive | 多个声明方立即冲突;完整原生 config file 属于此类 |
| keyed | 同 key、同规范化值去重但保留全部 provenance;值不同冲突 |
| ordered | 按作者与 plugins 数组的固定顺序追加,不去重 |
| set-like | 是否去重由该公开槽位的 owner 契约决定,core 不猜 |

flags 与 labels 都是 keyed。插件不能把 `{ memory: "baseline" }` 识别成可替换默认值;作者与插件值不同就是冲突。
