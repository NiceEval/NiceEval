# Plugins —— Library

所有 Plugin API 从 `niceeval/plugin` 导入。

```ts
type PluginOwner = "experiment" | "group" | "eval";
type PluginScope = PluginOwner | "sandbox";

interface PluginAttachment<Scopes extends PluginScope = PluginScope> {
  // 私有品牌携带 family identity 与可挂载 scope；作者不构造这个对象。
}

interface PluginStack<EligibleOwners extends PluginOwner = PluginOwner>
  extends Iterable<PluginAttachment> {
  use<const Scopes extends PluginScope>(
    attachment: CompatibleAttachment<EligibleOwners, Scopes>,
  ): PluginStack<Extract<EligibleOwners, Scopes>>;

  concat<const OtherOwners extends PluginOwner>(
    stack: CompatibleStack<EligibleOwners, OtherOwners>,
  ): PluginStack<Extract<EligibleOwners, OtherOwners>>;
}

declare function pluginStack(): PluginStack<PluginOwner>;

type PluginInput<Owner extends PluginOwner> =
  | PluginStack<Owner>
  | readonly PluginAttachment<Owner>[];
```

`CompatibleAttachment` 与 `CompatibleStack` 在 owner 集合没有交集时求值为 `never`，不会让 `PluginStack<never>` 悄悄流入 Definition。公开品牌保持 owner 逆变关系，使同时支持多个 owner 的 attachment 或 Stack 可以用于其中任一合法挂载点。

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
  sandbox: ({ marker }) => sandboxLayer().before(writeText({
    id: "example.lifecycle.marker",
    path: "/opt/example/marker",
    text: marker,
    changeFrequency: changeFrequency.normal,
  })),
});

export default defineExperiment({
  plugins: pluginStack()
    .use(lifecycle({ marker: "memory" }))
    .use(lifecycle({ marker: "telemetry" })),
  // ...
});
```

有参数 family 必须声明稳定的 `instanceKey(options)`。无参数 family 可省略它，固定实例键为 `"default"`，但仍通过 `family()` 产生 attachment specification。它可以被多个 Definition 或共享栈复用；owner 消费时才为每个挂载产生 occurrence。

`experiment`、`group` 与 `eval` fragment 只能包含可选 `identity`，以及至少一个 `setup` / `teardown`。公开 callback 返回 `void | Promise<void>`；Plugin 不暴露 Effect、资源 handle、cleanup 返回值或依赖注入协议。`sandbox` fragment 返回 command-only `SandboxLayer`，使用统一的 `before()` / `after()` API；它不能提供 template。

Plugin 的写法没有另起一套 action API。固定内容直接返回 `sandboxLayer().before(writeText(...) / uploadDirectory(...))`，也可以实例化第三方 package 导出的 `SandboxActionFamily`。family 不注册到 Plugin registry；Plugin 只转交 branded Action instance。

需要运行中实例的步骤可写 `.before(async (sandbox, context) => …)`，但它是每次真实执行的 opaque callback。Plugin 仍只在 owner 的 `plugins` 字段挂一次，runner 自动投影其中的 SandboxLayer。

## 挂载

```ts
const common = pluginStack().use(a());

defineExperiment({ plugins: common.use(b()), /* ... */ });
defineEvalGroup({ plugins: common.use(groupOnly()), /* ... */ });
defineEval({ plugins: common.use(evalOnly()), test(t) {} });
```

`pluginStack()` 是空栈和组合单位元；静态没有 Plugin 时推荐省略 `plugins`，两者产生相同 identity 与 debug。`.use(one)` 追加一个 attachment，`.concat(stack)` 合并两个共享栈；两者都返回新的冻结值，原栈可以安全分叉。最终 owner 消费后才按扁平顺序分配 `attachmentOrdinal`，栈的对象身份、分叉历史和 concat 分段不进入 identity。

```ts
const observability = pluginStack().use(metrics());
const memory = pluginStack().use(remem());

defineExperiment({
  plugins: enableMemory
    ? observability.concat(memory)
    : observability,
  // ...
});
```

`plugins: [a(), b()] as const` 仍是合法的简单输入；它与相同最终顺序的 `PluginStack` 产生相同 occurrence、fingerprint 和 debug。Stack 不自动去重；同一 owner 中重复的 `(name, instanceKey)` 仍在 link 阶段报错。

## 编译期边界

Plugin 类型契约必须验证以下矩阵：

- 多 owner attachment 经 `.use()` 后正确收窄 eligible owner；
- 一个公共 Stack 可以分叉为 Experiment Stack 与 Eval Stack；
- owner 集合有交集的 `.concat()` 合法；
- owner 集合无交集的 `.use()` / `.concat()` 在调用处报错；
- 空栈可用于 Experiment、Eval Group 与 Eval；
- 只声明 sandbox fragment 的 Plugin 在 `definePlugin()` 处报错；
- 同一 attachment specification 可跨 Definition 复用，但同一 owner 中的重复 family/key 仍由 link 拒绝。

不存在 `SandboxLayer.plugins()`。如果上面的 `a()` 同时声明 `sandbox` fragment，runner 自动将其 layer 投影到由该 owner 参与链接的物理 Sandbox。声明 `sandbox` 不要求用户再挂一次，也不会取得 Sandbox template 或 Provider 的所有权。

## Context

- `experiment`：`experimentId`、`selectedEvalIds`、`signal`、`progress`、`diagnostic`、`fact`。
- `group`：`experimentId`、`evalGroupId`、`signal`、反馈与 `fact`。
- `eval`：`experimentId`、`evalId`、`attempt`、可选 `evalGroupId`、`signal`、反馈与 `fact`。
- `sandbox`：唯一额外接收实际 `Sandbox`，并使用 `SandboxHookContext`。

## Experiment lifecycle

Experiment Plugin setup 排在作者 setup 后；teardown 逆序运行，并排在作者 teardown 前。

## Eval lifecycle

Eval Plugin 对每条 fresh Attempt 激活一次。多个 occurrence 按最终 attachment 正序 setup、逆序 teardown。
