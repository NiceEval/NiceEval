# Plugins

## 解决的问题

一个评估条件经常同时占据多个既有声明面。Remem 需要条件身份、Sandbox 探测、Codex 配置、安装后 hook、收尾 drain 与运行事实；Terminal-Bench 的公共 harness 又需要从 Eval 一侧复用。手工返回多个 fragment 会迫使作者记住每个落点和收尾顺序，漏接一项仍可能通过 TypeScript。

**Plugin 是可复用的 Eval / Experiment 条件蓝图。** 它可以挂在三个稳定定义入口：

```ts
defineEval({ plugins: [...] });
defineScoreEval({ plugins: [...] });
defineExperiment({ plugins: [...] });
```

folder、suite 与 `defineConfig()` 不产生隐式 Plugin 继承。目录级复用就是普通 TypeScript 常量或构造函数。

Plugin 在 factory 调用时求值成不可变定义值；NiceEval 在每个 Eval × Experiment pair 的 link 阶段组合两侧贡献。Plugin 不是新运行时、依赖注入容器或 marketplace，也不是 Codex / Claude Code 的 Agent Native Plugin。

## 消费示例

Remem package 携带 Dockerfile，而不是要求用户预先构建或发布镜像：

```ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerImage } from "niceeval/sandbox";
import { REMEM_DOCKER_CONTEXT, remem } from "@memorybench/remem-niceeval";

export default defineExperiment({
  ...memoryExperimentBase,
  agent: codexAgent(),
  sandbox: dockerImage({
    context: REMEM_DOCKER_CONTEXT,
    dockerfile: "remem.Dockerfile",
    lifetimeMs: 5 * 60 * 60_000,
  }),
  plugins: [remem({ memoryModel: "gpt-5.6-luna" })],
});
```

调用点仍显式拥有 Sandbox template。第一次缺少 BuildKey 时构建，之后只在同一 cache domain 命中时复用；cache 被回收或换 Domain 后会重建。准确契约见 [Docker Image](../docker-image/README.md)。

Eval 也能挂 Plugin：

```ts
export default defineEval({
  sandbox: dockerImage({ context: new URL("./sandbox/", import.meta.url) }),
  plugins: [workspaceContract({ packageManager: "pnpm" })],
  async test(t) {
    await t.agent("Implement the requested change");
  },
});
```

## 框架保证

- `definePlugin()` 给出完整作者 API；`attachments.eval` 与 `attachments.experiment` 在类型层限制各挂载点能力。
- 同一 `(name, instanceKey)` 在整个 pair 内只能出现一次；Eval 与 Experiment 两侧重复也会在创建资源前报错。
- 每个 owner 内先接作者贡献，再按 `plugins[]` 顺序接插件；跨 owner 顺序由 template owner 决定。
- 独占与 keyed 槽位不做 last-wins；冲突保留 attachment scope、owner、源码与数组位置。
- Plugin 只接入既有生命周期；setup 正序、teardown 按实际登记链逆序。
- Experiment attachment 行为进入 Run 级 `configHash`；Eval attachment 行为只进入对应 Eval fingerprint / manifest。
- Agent 专属贡献由 opaque receiver 规范化；core 不读取 payload，也不把凭据明文交给 Plugin。
- requirements 是封闭的 typed plan guard，只拒绝非法计划，不暗改 template、lifetime、Sequence 或并发。

可信 TypeScript Plugin 的模块 import 和 factory 必须保持纯函数。NiceEval 保证 discovery / link 不重跑 factory、不调用 lifecycle、不求值 runtime binding；框架不宣称能沙箱化或证明第三方模块纯度。

## Remem 状态边界

`remem()` 只支持 Experiment attachment，因为它贡献 Experiment flag 与 Codex AgentExtension。默认 `mode: "accumulated"` 要求 stop-group 的物理连续性和 Ordered Sequence complete-prefix；`mode: "isolated"` 必须显式选择。MemoryBench 六个独立 group 仍是六次 Invocation。

## 范围

Plugin 不替换 Agent、model、Sandbox template、provider、lifetime、resources、Sequence、并发、预算或 Eval 选择。

Plugin 不提供任意字符串 capability registry、返回 secret 的通用函数、动态下载或第三方隔离执行。

## 入口

- [Library](library.md) —— 完整 `definePlugin()` 作者 API 与两侧挂载示例
- [Architecture](architecture.md) —— pair link、顺序、身份、冲突与 Record 投影
- [Lifecycle](lifecycle.md) —— 资源作用域、失败与强杀恢复
- [Remem 用例](use-case/remem.md)
- [NiceEval-Eval 候选 Runtime](use-case/niceeval-eval-candidate-runtime.md)
- [Terminal-Bench Harness](use-case/terminal-bench-harness.md)
- [Docker Image](../docker-image/README.md) —— `dockerImage()` 与构建缓存的 Sandbox 单源
