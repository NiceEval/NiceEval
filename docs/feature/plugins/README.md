---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Plugins

Plugin 是带稳定身份的生命周期组合语法。它不提供新的资源系统、Agent 配置协议或 Sandbox 命令 DSL；这些能力继续由 Experiment、Agent、SandboxLayer 和 Provider 自己拥有。Plugin 的 Sandbox fragment 返回普通 `SandboxLayer`，因此固定上传、checkout 与 shell action 自动进入同一份准备缓存，不另声明 Plugin cache。

```ts
import { definePlugin, pluginStack } from "niceeval/plugin";

const remem = definePlugin({
  name: "example.remem",
  behaviorRevision: "1",
  experiment: () => ({
    setup: (ctx) => ctx.progress({ message: "prepare remem" }),
    teardown: (ctx) => ctx.diagnostic({
      code: "remem-released",
      level: "warning",
      message: "remem teardown finished",
    }),
  }),
});

export default defineExperiment({
  plugins: pluginStack()
    .use(remem())
    .use(metrics()),
  // ...
});
```

`definePlugin()` 调用返回可复用、冻结的 attachment specification；`pluginStack()` 用不可变 `.use()` 把它们组成有序栈。每次 Experiment、Eval Group 或 Eval 消费这个栈时才产生 lifecycle occurrence。Plugin 可以声明 `experiment`、`group`、`eval` 和 `sandbox` fragment；调用方只在实际 owner 的 `plugins` 字段挂一次。若 attachment 同时声明 `sandbox`，runner 会把该 layer 自动注入这次配对的实际物理 Sandbox，不在 SandboxLayer 上另写 `.plugins()`。

`PluginStack` 不是 `SandboxLayer`，不提供 template、缓存、资源或 action DAG。简单调用仍可给 `plugins` 传 readonly attachment 数组；链式栈用于分叉、条件追加和共享组合，两种输入在 definition 冻结前规范化成同一条有序 attachment 序列。

每个 Plugin 至少声明一个 fragment。`sandbox` 只能随实际 owner 自动投影，不成为第四种挂载点；只声明 sandbox fragment 的 Plugin 默认可挂到 Experiment、Eval Group 或 Eval，适合只负责 clone、上传或安装固定内容的工具链。只要同时声明 host fragment，可挂 owner 就由实际声明的 `experiment` / `group` / `eval` 集合收窄。

Plugin 不按目录、Config 或注册表隐式继承，也不拥有 Sandbox template、Provider、Agent 替换、flags、labels、Assertion、Verdict 或 Inspection delivery。

## 生命周期范围

| fragment | 基数 |
|---|---|
| `experiment` | 每个有 fresh work 的 Experiment Run 一次 |
| `group` | 每个 Experiment × Eval Group lane 一次，跨 replacement |
| `sandbox` | 每个实际物理 Sandbox 一次；replacement 重新执行 |
| `eval` | 每个 fresh Attempt 一次 |

完整 carry 不执行 lifecycle。Setup 按最终 attachment 顺序，teardown 按已激活 occurrence 的逆序；teardown 失败只记 diagnostic，并继续执行剩余 callback 与 Provider finalizer。

## V1 owner matrix

Experiment、Eval Group 和 Eval 都通过自己的 `plugins` 字段消费 attachment；Sandbox fragment 由这些挂载点自动投影。

## 入口

- [Library](library.md) —— `definePlugin`、多 occurrence 与挂载语法。
- [Architecture](architecture.md) —— 身份、自动 sandbox 投影与边界。
- [Lifecycle](lifecycle.md) —— 四个 scope 的运行顺序和失败语义。
- [Record → Inspection → Delivery](../record-report/README.md) —— Plugin callback 不取得 Record、Inspection 或 Delivery authority。
