# Plugins

Plugin 是一个可复用的实验条件，把条件身份、Agent 扩展、Sandbox 步骤和宿主前后步骤装进同一个值。
Experiment 通过 `plugins: [condition]` 挂载一次；固定内容、Action DAG、缓存和物理资源继续由各自的 SandboxLayer 与 Provider 管理。

```ts
import { definePlugin } from "niceeval/plugin";

const memory = definePlugin({
  name: "example.memory",
  identity: { version: "1" },
  agent: { skills: [{ kind: "local", path: "./skills/memory" }] },
  experiment: {
    before: (ctx) => ctx.progress({ message: "prepare memory" }),
    after: (ctx) => ctx.progress({ message: "release memory" }),
  },
});

export default defineExperiment({
  adapter: codexAgent(),
  plugins: [memory],
});
```

对象定义直接返回实例；函数定义返回单参数工厂。`name` 与 JSON 对象 `identity` 必填，`key` 默认 `"default"`。
条件版本只声明在 identity 中；回调函数体不参与 Plugin 投影。条件不会隐式进入 flags，也不替换 Adapter 或 Sandbox template。

## 范围与时机

| 字段 | 执行范围 |
| --- | --- |
| `experiment` | 每个至少有一条 fresh Attempt 的 Run 一次 |
| `group` | 每条有 fresh Attempt 的 Eval Group lane 一次，跨 replacement |
| `sandbox` | 每条 Attempt 的 Layer occurrence，reset 之后 |
| `attempt` | 每条 fresh Attempt 一次 |
| `agent` | 合并进内建 Agent factory 的扩展配置 |

Experiment 可挂载全部字段；Eval Group 仅允许 group、sandbox、attempt；Eval 仅允许 sandbox、attempt。
全部 carry 时零 Hook、零 Sandbox。`requires.evalGroup` 仍在完整 selection 上验证，包括将被 carry 的 Eval。
before 正序执行，after 按已激活顺序逆序执行。宿主 after 失败只写入 warning，Agent after 失败使 Attempt 失败；两者都继续剩余 after 与 Provider finalizer。

## 入口

- [Library](library.md)：实例、工厂、挂载矩阵、上下文与扩展合并。
- [Architecture](architecture/README.md)：条件身份、Layer 投影与职责边界。
- [Lifecycle](architecture/lifecycle.md)：顺序、carry、取消与失败收尾。
- [Use Case](use-case/terminal-bench-harness.md)：可复用条件的实际场景。
- [Run](../run/README.md) 与 [Inspection](../inspection/README.md)：执行事实与公开观察。
