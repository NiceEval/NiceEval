# Plugins —— Library

所有 Plugin API 从 `niceeval/plugin` 导入。Plugin 是一个可复用的实验条件，用同一个值声明条件身份、Agent 扩展与前后步骤。

## 定义

```ts
const memory = definePlugin((options: { cohort: string }) => ({
  name: "memory",
  key: options.cohort,
  identity: { version: "1", cohort: options.cohort },
  requires: { evalGroup: true },
  agent: { skills: [{ kind: "local", path: "./skills/memory" }] },
  sandbox: {
    before: async (sandbox, ctx) => {
      await sandbox.writeText("/tmp/group", ctx.evalGroup.id);
    },
  },
  group: { before: (ctx) => ctx.progress({ message: "prepare memory" }) },
}));

defineExperiment({
  adapter: codexAgent(),
  plugins: [memory({ cohort: "experiment-a" })],
});
```

`definePlugin(spec)` 直接返回冻结的 Plugin 实例；`definePlugin((options) => spec)` 返回只接收一个参数的工厂。
`name` 必须是非空字符串。`key` 省略时为 `"default"`。`identity` 必须是 JSON 对象，可为 `{}`，用于声明条件版本。
至少声明 `agent`、`experiment`、`group`、`sandbox`、`attempt`、`state` 中的一项。生命周期字段使用 `before` 与 `after`，各自接受一个元素或 readonly 数组。

`behaviorRevision`、`instanceKey`、旧 `eval` 字段和 `setup` / `teardown` 在定义期拒绝。组合使用 readonly 数组，不提供 `pluginStack()`。

## 挂载与上下文

| 挂载点 | 允许的字段 | 作用范围 |
| --- | --- | --- |
| `Experiment.plugins` | 全部 | 本次 Experiment 选择的全部 Eval |
| `EvalGroup.plugins` | `group`、`sandbox`、`attempt`、`state` | 本 Group 的成员 |
| `Eval.plugins` | `sandbox`、`attempt` | 本 Eval |

类型与加载期均拒绝不允许的字段。同一 Attempt 的生效集合中，跨挂载点重复的 `(name, key)` 也会拒绝。
挂在 Experiment 上的 `group` 对每条 Group lane 激活一次；`attempt` 对每条 fresh Attempt 激活一次。未分组 Eval 不激活 `group`。

- `experiment` 上下文提供 `experimentId`、`selectedEvalIds`、`signal`、`progress` 与 `diagnostic`。
- `group` 上下文提供 `experimentId`、`evalGroupId`、`signal` 与反馈函数。
- `attempt` 上下文提供 `experimentId`、`evalId`、`attempt`、可选 `evalGroup`、`signal` 与反馈函数。
- `sandbox` 回调使用 `SandboxCommandContext`，绑定当前 Attempt、signal、owner 与可选 `evalGroup`。

声明 `requires: { evalGroup: true }` 后，`sandbox` 与 `attempt` 回调的 `ctx.evalGroup` 类型必有。未声明时为可选。
完整 selection 形成后，在任何 build、prepare、Sandbox 创建或宿主 Hook 前验证此要求，含将被 carry 的 Eval。未分组项以 `plugin-requires-eval-group` 列出。

## Sandbox 步骤

`sandbox: { before, after }` 的元素与 SandboxLayer `.before()` / `.after()` 相同：受管 Action 或 `(sandbox, ctx) => …` 回调。
它投影到挂载点对应的 owner layer；每条 Attempt 在 reset 后形成 occurrence，不增加物理生命周期。
受管 Action 进入既有 DAG 与 before 缓存，回调每条 fresh Attempt 执行。需要 lane 只做一次的工作应使用 `group`。

DAG 先按依赖，再按 changeFrequency，最后按 owner 与声明序号排序。每个 Plugin 的 `sandbox.before` 数组按书写顺序连边；作者 layer 与各 Plugin fragment 之间没有隐式边。
频率相同时，Plugin 元素排在同一 owner 的作者元素之后，再按 Plugin 挂载序号排序。跨 fragment 的顺序使用 `dependsOn` 或 capability，见 [Sandbox Layer](../sandbox/library/layers.md#顺序与依赖方向)。
Eval 挂载的 Sandbox 字段隔离普通 reuse pool；同一 Group 成员的该字段身份不一致时，在创建前报 `eval-group-incompatible`。

## State

`state` 接受 [State](../state/README.md) binding 数组，语义与 Experiment 的 `state` 字段相同：在 Eval Group 物理 Sandbox 的恢复点恢复、退役时保存。它需要 Eval Group，使用 `state` 的 Plugin 应同时声明 `requires: { evalGroup: true }`。细则见 [State Library](../state/library.md#挂载)。

## Agent 扩展

`agent` 只允许挂在 Experiment 上。通用字段为 `skills` 与 `mcpServers`；专用字段与对应工厂的同名配置一致：

| 字段 | 配置 |
| --- | --- |
| `codex` | `plugins`、`configFile`、`before`、`after` |
| `claudeCode` | `plugins`、`settingsFile`、`before`、`after` |
| `bub` | `pythonPlugins`、`before`、`after` |

factory 自身配置在前，各 Plugin 按数组顺序追加。合并后的 before 正序执行，after 逆序执行。
Skill、MCP server 和原生插件重名时报出两处声明位置。`configFile` / `settingsFile` 只能由 factory 或一个 Plugin 声明。
Bub 不接受 `mcpServers`。声明了专用子字段却缺少所选 Agent 的子项时拒绝；自定义 Adapter 不接受 `agent` 扩展。
连接参数与凭据仍由工厂或 Hook 执行时求值。

## 条件身份

Attempt fingerprint 包含挂载层级、数组位置、`name`、`key`、`identity`、`requires`、各字段形状和 before / after 数量。
Sandbox Action 使用既有 canonical identity；Agent 投影包含 Skill 规格及本地内容摘要、MCP name / command / args / url、原生插件规格与配置文件内容摘要。
MCP headers 与 env 不进入身份。

Plugin 回调函数体不进入投影。只改 Experiment 模块中的回调可继续 carry；修改 `identity` 或使用 `--rerun all` 请求重跑。
Eval 模块及其静态 import 仍受 sourceClosure 规则约束。没有 Plugin 的 Experiment 保持既有 config identity。
`show`、`query` 与 `view` 展示生效条件的 `name`、`key`、`identity`；这些值不会自动进入 flags。
