# PLAN-2：Library

本篇是 PLAN-2 公开调用形状的单一来源。
方案取舍见 [README](README.md)，运行和身份语义见 [Architecture](architecture.md)，完整场景见 [Use Cases](use-case/README.md)。

## template 声明

Eval 可以声明题目起点：

```typescript
export default defineEval({
  environment: composeEnvironment({
    file: new URL("docker-compose.yaml", import.meta.url),
    workspaceService: "client",
  }),
  async test(t) {
    await t.send(TASK);
  },
});
```

Experiment 可以声明普通默认 template：

```typescript
export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE }),
});
```

Provider spec 可以按 Eval environment profile 指定预制 template：

```typescript
dockerSandbox({
  templates: {
    "terminal-bench/sheets": "acme/tb-sheets@sha256:...",
  },
});
```

`templates` 的 key 是 environment profile，值是该 Provider 的原生起点引用。
它替换同 profile 的 folder-local environment，不建立第二种安装机制。

三种声明只竞争一个槽位，精确优先级见 [Architecture](architecture.md#template-解析)。

## `defineLayer`

Layer 声明一个目标安装身份，以及把当前 Sandbox 改到该身份的安装动作：

```typescript
const mempal = defineLayer({
  name: "mempal",
  identity: {
    version: "0.9.0",
    installerDigest: MEMPAL_INSTALL_SH_SHA256,
    model: "minilm-l6@sha256:9f2c...",
  },
  install: async (sandbox) => {
    await installMempal(sandbox, MEMPAL_INSTALL_SH);
  },
});
```

候选公开形状为：

```typescript
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type LayerIdentity = Readonly<Record<string, JsonValue>>;

type LayerInspection =
  | { installed: false; reason: string; detail?: string }
  | {
      installed: true;
      identity: LayerIdentity;
      facts?: Readonly<Record<string, string | number | boolean>>;
    };

interface LayerSpec<I extends LayerIdentity> {
  name: string;
  identity: I;
  inspect?(
    sandbox: Sandbox,
    context: LayerContext<I>,
  ): Promise<LayerInspection>;
  install(
    sandbox: Sandbox,
    context: LayerContext<I>,
  ): Promise<void>;
}

interface LayerContext<I extends LayerIdentity> {
  identity: I;
  signal: AbortSignal;
  progress(update: ProgressUpdate): void;
  diagnostic(diagnostic: DiagnosticInput): void;
}
```

`name` 在一条解析后的 Attempt 内唯一。
`identity` 必须覆盖版本、安装脚本与其它会改变安装结果的输入；函数体本身不参与哈希。

省略 `inspect` 时，框架读取受管 manifest 并比较其中的 `{ name, identity }`。
安装成功后框架把同一形状写入 manifest。

提供 `inspect` 时，返回值描述实际状态；框架比较实际 identity 与目标 identity。
`inspect` 是 manifest 无法代表真实状态时的逃生舱，不改变 Layer 的其余形状。

Layer 没有 `prepare`。
宿主侧离线 payload、按目标平台 single-flight 和共享 stage 不是本候选的能力。

## Experiment 与 Eval 的 `layers`

Experiment 通过 `layers` 声明整场实验条件：

```typescript
export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({ template: BASE_TEMPLATE }),
  layers: [companyCertificates, mempal],
});
```

Eval 也可以声明只属于该题目的附加 Layer：

```typescript
export default defineEval({
  layers: [taskRuntime],
  async test(t) {
    await t.send(TASK);
  },
});
```

两处 Layer 与 Adapter 内部的 Agent Layer 合并成一个无序集合。
数组位置不表达依赖；全部未命中项并行安装。
有顺序依赖或共享包管理器的内容必须合并成一个 Layer。

Agent Layer 不作为 Experiment 作者可见的值导出。
Adapter 把 Agent CLI 的最小 `identity + install` 投影进同一池，但 staged payload、安装模式和 Agent 安装事实没有公开表达位。

## 与状态 Hook 的边界

Layer 只表达可由安装动作建立的状态。
外部状态载入和回存继续使用 Sandbox `.setup()` / `.teardown()`；workdir 任务素材继续使用 Eval Fixture。

状态 Hook、Fixture 与 Layer 不能互相替代。
