# Plugins —— Library

所有 Plugin API 从 `niceeval/plugin` 导入。

## Occurrence

有参数 family 必须声明稳定实例键：

```ts
const repositoryCondition = definePlugin({
  name: "example.repository",
  behaviorRevision: "2",
  instanceKey: ({ repository, revision }: { repository: string; revision: string }) =>
    `${repository}@${revision}`,
  eval: (input) => ({
    identity: { repository: input.repository, revision: input.revision },
  }),
});
```

无参数 family 可以省略 `instanceKey`，固定使用 `"default"`。它仍返回零参数 factory，调用 `family()` 后才得到 occurrence；向它传参数在动态 JavaScript 边界报错。

`name`、`behaviorRevision` 与 `instanceKey` 都是行为身份。同一 pair 中重复的 `(name, instanceKey)` 是 link 错误，即使两个 occurrence 附着在不同 owner。

一个 family 可以声明多个 owner callback，但 occurrence 只应用实际 attachment owner 的 fragment。它不会跨 owner 自动展开。

## Sandbox resource

```ts
type RepositoryDemand = {
  repository: string;
  revision: string;
  into: string;
};

const repository = defineSandboxResource<"docker", RepositoryDemand, { readonly root: string }>({
  receiver: "docker",
  behaviorRevision: "1",
  demand: ({ repository, revision, into }) => ({ repository, revision, into }),
  materialize: (demands, context) => Effect.gen(function* () {
    context.progress({ message: `materializing ${demands.length} repositories` });
    context.fact("repository.count", demands.length);
    return { root: "/workspace" };
  }),
  prepare: (handle, demand, context) => Effect.gen(function* () {
    void handle;
    void demand.repository;
    context.timing({ key: "plugin.repository.prepare", label: "prepare repository", durationMs: 0 });
  }),
  release: (_handle, context) => Effect.sync(() => {
    context.diagnostic({ code: "repository-released", level: "warning", message: "repository resource released" });
  }),
});
```

`repository(value)` 返回 opaque、receiver-branded demand。Core 只规划 credential-free projection；callback 收到归一并深冻结的 typed payload，不读取内部 token。

Eval 和 Group Plugin 都能贡献 `resources`。Eval demand 每个 pair occurrence 一份；Group demand 每个 Experiment × Group × occurrence 一份。两者进入同一个 physical envelope。

`materialize` 每台物理 Sandbox 执行一次，`release` 在该实例结束时执行一次。`prepare` 对每条适用的真实 Attempt 执行；Group prepare 先于当前 Eval prepare，随后才运行对应 owner 的 Plugin Sandbox commands。

`progress` 是短期反馈；`diagnostic`、`fact` 与 `timing` 是 credential-safe 运行收据。

## Group Plugin

Group Plugin 声明闭合成员集共享的物理条件：

```ts
const sharedIndex = definePlugin({
  name: "example.shared-index",
  behaviorRevision: "1",
  group: () => ({
    identity: { indexFormat: 1 },
    resources: [indexResource({ format: 1 })],
    sandbox: sandboxLayer().prepare(shell("test -f /opt/index/ready")),
  }),
});

export default defineEvalGroup({
  evals: [first, second],
  onUnavailable: "replace-sandbox",
  plugins: [sharedIndex()],
});
```

Group Plugin command 与 Group 作者 command 都对每条真实 Attempt 执行，作者 command 在前。只需每台物理实例执行一次的工作必须放进 resource `materialize`，不能用 command 模拟 physical Hook。

## AgentExtension

```ts
const extension = codexAgentExtension({
  skills: [{ kind: "local", path: ".agents/skills/review" }],
  configFile: "config/codex.toml",
  env: { PRIVATE_SERVICE_TOKEN: process.env.PRIVATE_SERVICE_TOKEN! },
  mcpServers: [{ name: "tools", command: "node", args: ["server.mjs"] }],
});
```

`codexAgentExtension()` 与 `claudeCodeAgentExtension()` 构造 receiver-branded extension；只有 Experiment Plugin 能贡献它。`composeAgentExtensions(agent, extensions)` 是 receiver-checked composition 入口。

Canonical behavior projection 包含安装与命令声明，只保存 env 与 MCP credential key，不保存值。会改变行为的配置同时进入 Plugin `identity`、`instanceKey` 或新的 `behaviorRevision`；单独轮换凭据不让旧结果失效。

## Experiment lifecycle

Experiment Plugin 的 `setup` 在作者 setup 后按 Plugin 顺序运行；Plugin `teardown` 逆序运行，并排在作者 teardown 前：

```ts
experiment: () => ({
  setup: (context) => context.progress({ message: "preparing experiment" }),
  teardown: (context) => context.diagnostic({
    code: "example-teardown",
    level: "warning",
    message: "experiment teardown finished",
  }),
})
```

Eval 与 Group Plugin 不提供宿主机 lifecycle Hook。

