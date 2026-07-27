# Experiment 对账 —— 库用法

公开 API 让 Experiment 声明证据要求与外部资源。
用户不写 `requirementKey`，也不决定某个字段是否进哈希；
系统从声明、解析结果与只读观测生成完整 `ExecutionManifest`。

## Agent 以 `AgentSpec` 声明被测条件

Agent 工厂返回的对象必须带可序列化 spec。
凭据 bindings 与 spec 分开，不能用可选投影静默退化：

```typescript
interface Agent {
  readonly name: string;
  readonly kind: "direct" | "sandbox";
  readonly spec: AgentSpec;
}

interface AgentSpec {
  adapter: string;
  options: Record<string, JsonValue>;
}
```

Adapter 工厂把所有会改变被测行为的参数放进 `options`：

```typescript
export function codexAgent(opts: CodexOptions): SandboxAgent {
  return {
    name: "codex",
    kind: "sandbox",
    spec: {
      adapter: "codex",
      options: { webSearch: opts.webSearch ?? false },
    },
    async send(input, ctx) { /* … */ },
  };
}
```

`webSearch` 改变后 Requirement 不同，历史 Evidence 默认失效。
API key、token 与凭据路径不在 `AgentSpec` 中，只经 secret binding 提供。

空 `options` 也必须显式返回。
这样 Run 能区分「这个 Agent 没有行为参数」和「Adapter 忘了声明身份」。

## Experiment 显式声明外部资源

外部资源分成三个互相独立的事实：

| 事实 | 例子 | 进入 manifest | 落盘 |
|---|---|---|---|
| 连接坐标 | URL、socket、隧道地址 | 否 | 否；需要审计时另报 fact |
| 凭据 | token、API key | 否 | 否 |
| 资源身份 | 数据 epoch、实例 ID、快照版本 | 是 | 是 |

Experiment 在 `resources` 声明规划前 observer：

```typescript
import { defineExperiment, observeResource } from "niceeval";

export default defineExperiment({
  agent: codexAgent(),
  resources: [
    observeResource({
      id: "memory-corpus",
      async observe({ env, signal }) {
        const response = await fetch(`${env.secret("NMEM_URL")}/version`, {
          headers: { authorization: `Bearer ${env.secret("NMEM_API_KEY")}` },
          signal,
        });
        return (await response.json()).corpusVersion;
      },
    }),
  ],
});
```

observer 有四条约束：

- 只读，不创建、清空、导入或修改资源；
- 返回 JSON 值作为稳定版本，不返回连接坐标或凭据；
- 发生在 setup 与对账之前；
- 失败时产生计划诊断，并使依赖它的 Requirement 变成 `opaque`。

资源可按 eval 选择性依赖，避免一个 GPU 数据集 observer 让无关 eval 失去沿用能力：

```typescript
observeResource({
  id: "memory-corpus",
  appliesTo: (e) => e.tags.includes("memory"),
  async observe(ctx) { /* … */ },
});
```

`appliesTo` 在发现后的 `EvalDescriptor` 上同步求值。
它只决定哪些 Requirement 引用这份版本，不改变 `selectedEvalIds`。

### 静态 epoch

服务没有版本接口时，Experiment 可以从 flags 声明资源身份：

```typescript
export default defineExperiment({
  flags: {
    corpusEpoch: "2026-07-20-empty",
  },
  resources: [
    observeResource.fromFlag({
      id: "memory-corpus",
      flag: "corpusEpoch",
      appliesTo: (e) => e.tags.includes("memory"),
    }),
  ],
});
```

清库、换实例或导入种子数据时修改 epoch。
这仍需要操作者在状态变更时更新一次，但不会要求每次 Invocation 决定是否使用 `--rerun all`。

没有 observer 或静态 epoch 的外部资源不能被证明未变化。
依赖它的 Requirement 是 `opaque`，默认每次派发。

## 连接坐标与凭据绑定

Sandbox env 每个键必须声明来源：

```typescript
import { e2bSandbox, fromFlag, fromSecret } from "niceeval/sandbox";

sandbox: e2bSandbox({ template: "niceeval-agents" }).env({
  MEM_BACKEND: fromFlag("memBackend"),
  NMEM_URL: fromSecret("NMEM_URL"),
  NMEM_API_KEY: fromSecret("NMEM_API_KEY"),
});
```

| 通道 | 值从哪来 | 进入 manifest | 缺失时 |
|---|---|---|---|
| `fromFlag(key)` | Experiment flags | 是 | 解析期报错 |
| `fromSecret(name)` | 宿主进程环境 | 否 | 需要 observer 或执行时才报错 |

`fromSecret` 同时承载坐标与凭据，因为两者都不能落盘。
「坐标背后是不是同一个资源」不由 env key 判断，而由 `resources` 的身份回答。

## Sandbox 使用声明式 `EnvironmentRecipe`

高频环境预置用数据描述，不依赖函数源码猜语义：

```typescript
sandbox: e2bSandbox({ template: "niceeval-agents" })
  .recipe([
    {
      run: {
        command: "npm",
        args: ["install", "--global", "some-cli@2.1.0"],
      },
    },
  ]);
```

recipe、参数、文件 digest 与解析后的 immutable template / image ID 进入 manifest。
provider 在解析期把 mutable 名称解析成内容 ID；解析失败时环境为 `opaque`。

任意 `.setup(fn)` 仍可使用，但函数闭包不能可靠投影成身份。
没有配套 recipe 或 resource observer 时，相关 Requirement 默认 `opaque`。
这是显式承认能力边界，不用 `Function#toString()` 制造虚假的确定性。

## loader 家族

数据文件必须经 loader 读取，系统才能把 path 与 digest 放进 source manifest：

```typescript
import { loadText, loadBytes, loadYaml, loadJson } from "niceeval/loaders";

const cases = await loadYaml("evals/data/recall-cases.yaml");
const template = await loadText("evals/data/recall-prompt.md");
const golden = await loadBytes("evals/data/expected.bin");
```

| 函数 | 返回 |
|---|---|
| `loadYaml(path)` | 解析后的数据 |
| `loadJson(path)` | 解析后的数据 |
| `loadText(path)` | 文件文本 |
| `loadBytes(path)` | 文件字节 |

四个 loader 都在发现阶段读完整文件。
manifest 按整份内容算 digest；一个文件生成的全部 eval 因此共享同一输入版本。
要缩小失效面就按变更频率拆文件，见 [读入数据文件](use-case/读入数据文件.md)。

直接使用 `fs.readFileSync`、动态 `import()` 或项目外依赖时，系统无法建立完整 manifest。
对应 Requirement 默认 `opaque`，而不是假装这些输入不存在。
