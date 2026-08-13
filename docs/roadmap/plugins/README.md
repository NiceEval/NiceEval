# Plugins

Plugin 是带稳定身份的生命周期组合语法。它不提供新的资源系统、Agent 配置协议或 Sandbox 命令 DSL；这些能力继续由 Experiment、Agent、SandboxLayer 和 Provider 自己拥有。

```ts
import { definePlugin } from "niceeval/plugin";

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
  plugins: [remem(), metrics()],
  // ...
});
```

`plugins` 始终是数组，因此一个位置可以组合多个 occurrence。Plugin 可以声明 `experiment`、`group`、`eval` 和 `sandbox` fragment；调用方只在 Experiment、Eval Group 或 Eval 的 `plugins` 数组挂一次。若 occurrence 同时声明 `sandbox`，runner 会把该 fragment 自动注入这次配对的实际物理 Sandbox，不在 SandboxLayer 上另写 `.plugins()`。

Plugin 不按目录、Config 或注册表隐式继承，也不拥有 Sandbox template、Provider、Agent 替换、flags、labels、Assertion、Verdict 或 Report。

## 生命周期范围

| fragment | 基数 |
|---|---|
| `experiment` | 每个有 fresh work 的 Experiment Run 一次 |
| `group` | 每个 Experiment × Eval Group lane 一次，跨 replacement |
| `sandbox` | 每个实际物理 Sandbox 一次；replacement 重新执行 |
| `eval` | 每个 fresh Attempt 一次 |

完整 carry 不执行 lifecycle。Setup 按数组顺序，teardown 按已激活 occurrence 的逆序；teardown 失败只记 diagnostic，并继续执行剩余 callback 与 Provider finalizer。

## V1 owner matrix

Experiment、Eval Group 和 Eval 都通过自己的 `plugins` 数组挂载 lifecycle occurrence；Sandbox fragment 由这些挂载点自动投影。

## 入口

- [Library](library.md) —— `definePlugin`、多 occurrence 与挂载语法。
- [Architecture](architecture.md) —— 身份、自动 sandbox 投影与边界。
- [Lifecycle](lifecycle.md) —— 四个 scope 的运行顺序和失败语义。
- [RecordAttachment adapter SPI](../record-attachment-authoring/README.md) —— 领域 SDK 的 opaque binding 不向普通 Plugin callback 暴露 Record。
