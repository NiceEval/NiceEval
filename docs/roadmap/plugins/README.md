# Plugins

Plugin 是 NiceEval 原生理解的、显式且 owner-scoped 的声明模块。它把一个 owner 上必须共同出现的行为身份、Sandbox 条件、物理资源或 Agent 扩展收成一个不可变 occurrence；runner 负责 link、冲突检查、carry 失效、资源生命周期和 provenance。

它不是只给 lifecycle Hook 换一层写法。普通对象或共享函数不能让 runner 知道「这些贡献属于同一个条件」，也不能自动得到稳定身份、receiver 校验、physical resource 聚合和可审计的 dry plan。

```ts
import { definePlugin } from "niceeval/plugin";

const repository = definePlugin({
  name: "example.repository",
  behaviorRevision: "2",
  instanceKey: ({ revision }: { revision: string }) => revision,
  eval: ({ revision }) => ({
    identity: { revision },
    resources: [repositorySeed({ revision })],
  }),
});

export default defineEval({
  plugins: [repository({ revision: "8f3c1a2" })],
  test(t) {},
});
```

## 价值单位

一个 Plugin occurrence 只属于一个 owner：Eval、Experiment 或 Eval Group。它的完整性只相对于该 owner，不会从一次 attachment 跨 owner fan-out。

同一个 family 可以声明多个 owner callback。这只表示同一套命名与选项可在不同 owner 位置使用；调用方仍在实际 owner 的 `plugins` 数组中显式挂载。相同 `(name, instanceKey)` 不得在同一 Eval × Experiment pair 从多个 owner 重复出现，避免一个逻辑实例被拆成多个 provenance 分支。

Plugin 不按目录、Config、命名空间或注册表隐式继承。每个 occurrence 的配置声明位置在调用点可见。

## V1 owner matrix

| owner | 可贡献内容 | 负责的条件 |
|---|---|---|
| Eval | identity、resource demand、command-only Sandbox layer | 单道 Eval 的题目 Sandbox 条件 |
| Experiment | identity、flags、labels、command-only Sandbox layer、setup、teardown、AgentExtension | 整场实验与既有 Agent 的条件 |
| Eval Group | identity、group-scoped resource demand、command-only Sandbox layer | 闭合成员集共享的物理 Sandbox 条件 |

`requirements` 不属于 V1。没有封闭能力词表、求解规则和失败语义的任意 JSON 只是 metadata，不能冒充 planning constraint。具体 receiver 约束由 branded `SandboxResource` 与 `AgentExtension` 在 link 时验证。

Eval Plugin 不提供私有 before/after Hook。Group Plugin 不提供宿主机 setup/teardown、AgentExtension、flags 或 labels。Plugin 不拥有 Sandbox template、Provider、Docker image、私有 Git 鉴权、Agent 替换、业务顺序、Assertion、Verdict 或 Report。

Plugin callback 在 occurrence 构造时归一并深冻结，不联网、不启动进程、不读取动态运行状态。只有 `niceeval/plugin` 暴露 Effect v3 类型；根入口保持不变。

## API 甜度

有参数 family 必须显式提供 `instanceKey(options)`。无参数 family 可以省略 `instanceKey`，其固定实例键是 `"default"`；两种 family 都通过调用 factory 产生 occurrence：

```ts
const isolated = definePlugin({
  name: "example.isolated",
  behaviorRevision: "1",
  experiment: () => ({ identity: { mode: "isolated" } }),
});

export default defineExperiment({
  plugins: [isolated()],
  // ...
});
```

不增加 `defineEvalPlugin` 等第二套 owner DSL，也不让 `definePlugin()` 有时返回 occurrence、有时返回 factory。

## 入口

- [Library](library.md) —— `definePlugin`、resource 与 AgentExtension API。
- [Architecture](architecture.md) —— link、身份、fingerprint、carry 与公开审计形状。
- [Lifecycle](lifecycle.md) —— Eval 与 Group resource 的 Effect 生命周期及失败归属。
- [Eval Group](../eval-groups/README.md) —— 共享物理 Sandbox 的组语义。

