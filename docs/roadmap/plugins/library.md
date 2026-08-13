# Plugins —— Library

所有 Plugin API 从 `niceeval/plugin` 导入。

## 定义与多个 occurrence

```ts
const lifecycle = definePlugin<{ marker: string }>({
  name: "example.lifecycle",
  behaviorRevision: "2",
  instanceKey: ({ marker }) => marker,
  experiment: ({ marker }) => ({
    identity: { marker },
    setup: (ctx) => ctx.progress({ message: `setup ${marker}` }),
    teardown: (ctx) => ctx.progress({ message: `teardown ${marker}` }),
  }),
  sandbox: ({ marker }) => ({
    identity: { marker },
    setup: (sandbox, ctx) => ctx.progress({ message: `${marker}: ${sandbox.sandboxId}` }),
    teardown: (_sandbox, ctx) => ctx.progress({ message: `release ${marker}` }),
  }),
});

export default defineExperiment({
  plugins: [
    lifecycle({ marker: "memory" }),
    lifecycle({ marker: "telemetry" }),
  ],
  // ...
});
```

有参数 family 必须声明稳定的 `instanceKey(options)`。无参数 family 可省略它，固定实例键为 `"default"`，但仍通过 `family()` 产生 occurrence。

每个 fragment 只能包含可选 `identity`，以及至少一个 `setup` / `teardown`。公开 callback 返回 `void | Promise<void>`；Plugin 不暴露 Effect、资源 handle、cleanup 返回值或依赖注入协议。

## 挂载

```ts
defineExperiment({ plugins: [a(), b()], /* ... */ });
defineEvalGroup({ plugins: [a(), b()], /* ... */ });
defineEval({ plugins: [a(), b()], test(t) {} });
```

不存在 `SandboxLayer.plugins()`。如果上面的 `a()` 同时声明 `sandbox` fragment，runner 自动将其投影到由该 owner 参与链接的物理 Sandbox。声明 `sandbox` 不要求用户再挂一次，也不会取得 Sandbox template 或 Provider 的所有权。

## Context

- `experiment`：`experimentId`、`selectedEvalIds`、`signal`、`progress`、`diagnostic`、`fact`。
- `group`：`experimentId`、`evalGroupId`、`signal`、反馈与 `fact`。
- `eval`：`experimentId`、`evalId`、`attempt`、可选 `evalGroupId`、`signal`、反馈与 `fact`。
- `sandbox`：唯一额外接收实际 `Sandbox`，并使用 `SandboxHookContext`。

## Experiment lifecycle

Experiment Plugin setup 排在作者 setup 后；teardown 逆序运行，并排在作者 teardown 前。

## Eval lifecycle

Eval Plugin 对每条 fresh Attempt 激活一次。多个 occurrence 按数组正序 setup、逆序 teardown。
