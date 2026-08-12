# 用 Plugin 声明 Remem 条件

## 当前接线

MemoryBench 当前需要作者同时知道四个落点:

```ts
export default defineExperiment({
  agent: codexAgent(rememCodexConfig(MODEL)),
  flags: rememFlags(MODEL),
  sandbox: dockerImage({
    context: REMEM_DOCKER_CONTEXT,
    dockerfile: "remem.Dockerfile",
    lifetimeMs: 5 * 60 * 60_000,
  }).prepare(rememPrepare()),
  maxConcurrency: 4,
});
```

`rememCodexConfig()` 内部又要拼 `configFile`、env、`postSetup` 与 `preTeardown`;其 factory 在 import 时读取 Codex endpoint 与 API key。Experiment 调用点看不出这些 fragment 必须成套出现,也无法静态证明跨题历史的完整性。这些旧字段只是现状，不是 Plugin 目标 API：roadmap 会把安装能力统一成 `AgentExtension`，把 secret 延迟到 materialize。

## Plugin 调用点

兼容起点仍由 Experiment 明确选择。插件只收起同一个条件的跨切面贡献:

```ts
const memoryExperimentBase = {
  evals: ["toggl-cli/"],
  agent: codexAgent(),
  model: MODEL,
  sandbox: dockerImage({
    context: REMEM_DOCKER_CONTEXT,
    dockerfile: "remem.Dockerfile",
    lifetimeMs: 5 * 60 * 60_000,
  }),
  timeoutMs: 1_800_000,
} as const;

export default defineExperiment({
  ...memoryExperimentBase,
  plugins: [remem({ memoryModel: MODEL })],
});
```

这个 base 是可组合的中性输入,不是已经带 `{ memory: "baseline" }` 的完整 baseline Experiment。无记忆对照自己声明 baseline flag / label,Remem 插件声明 remem 值;两者不互相替换。

`remem()` 的贡献:

| 现有手工 fragment | Plugin 归属 |
|---|---|
| `rememFlags(MODEL)` | 原生 `flags` / `labels` 字段 |
| `.prepare(rememPrepare())` | command-only Sandbox layer |
| Remem Skill／MCP／Codex Native Plugin | `skillsExtension()`、`mcpServersExtension()` 与 `codexNativeExtension()` |
| 安装后注册脚本 | `agentLifecycleExtension().afterConfigure` 稳定命令 |
| extraction drain 与数据库检查 | `agentLifecycleExtension().beforeAgentTeardown` 有序槽位 |
| Remem 专属 API key | `credentialFromEnv()` runtime binding；selector／value 不进 identity |
| Codex 主 endpoint／API key | `codexAgent()` base-only；Plugin 无权改写，也不取得明文 |
| 5 小时寿命 | Experiment 仍显式声明;planning requirement 只验证 requested value |
| Remem Dockerfile | package 静态资产，由调用点的 `dockerImage()` 显式选择 |
| Remem 二进制与版本 | `sandbox.prepare.experiment` 实机探测 |

Remem 自带的 Skill、Codex Plugin 与脚本使用 `pluginAsset(new URL(..., import.meta.url))` 随包定位；selected planning snapshot 计算内容 digest。远程安装 package 必须固定完整 commit 或 content digest。Plugin 不向完整 `config.toml` 打 patch；需要的 MCP、Native Plugin 与 native Hook 都走 Codex receiver 的窄 typed slot。

`@memorybench/remem-niceeval` 把 Dockerfile 随包发布，并导出普通 `REMEM_DOCKER_CONTEXT` URL。它不再导出预制镜像常量，也不要求用户先跑手工 build 脚本。同一 BuildKey 首次 cache miss 时构建，后续只在同一 cache domain 精确命中时复用；详见 [Docker Image](../../docker-image/README.md)。

## Accumulated 模式

默认模式要证明“本轮前一题留下的状态被后一题消费”,因此 Experiment 还必须选择一条 complete-prefix Sequence,且成员属于同一个 stop-group 物理 Sandbox。插件 requirements 只验证这些事实,不替作者创建它们。

```bash
pnpm exec niceeval exp compare/codex-remem --sequence toggl-cli
```

Sequence 每一步真实派发,不由 carried 结果替代。`passed` / `failed` 封口后才进入下一步;errored、中断或不完整前缀不会被描述成有效记忆历史。

当前一条命令只能选择一条 Sequence。六个独立 group 因此运行六次 Invocation;本主题不把它包装成一个看似等价的单命令。

## Isolated 模式

只验证 Remem 在单 Attempt 内安装、捕获、提炼与收尾时,显式降为:

```ts
export default defineExperiment({
  ...memoryExperimentBase,
  plugins: [remem({ memoryModel: MODEL, mode: "isolated" })],
});
```

该模式不要求 Sequence 或 stop-group,也不承诺任何跨 Eval 记忆。缺少 accumulated requirements 时不会自动进入 isolated;作者必须在调用点承担这项语义选择。

## 可核查结果

实现后的真实验收至少检查:

1. dry plan 展示 `dev.remem.agent-extension` identity、AgentExtension → receiver 与 asset digest；
2. dry plan 区分 Hosted／native Hook，展示 prepare／lifecycle 顺序与 requirements，不出现 credential selector／value 或宿主绝对路径；
3. 缺 Sequence、stop-group 或 5 小时 requested lifetime 时在创建 Sandbox 前失败;
4. 错误镜像在 `sandbox.prepare.experiment` 报 Remem 版本探测失败并点名 plugin source;
5. 同一 Sequence 的后一步看到前一步留下的 `$HOME/.remem` 状态,且没有 carried 前序;
6. `beforeAgentTeardown` 在 Agent teardown 前排空 extraction queue，receiver overlay 只在 Agent teardown 后 dispose；失败只归既有 lifecycle／teardown aggregation;
7. 同一插件 blueprint 被两个 Experiment 并发使用时,运行时状态与 typed Attachment write 互不改写;
8. 强杀恢复只在 linked Plugin identities 完全匹配时运行当前 teardown；下一条复用 Attempt 的完整 desired state 不继承上一条的 Remem Skill、MCP、native Hook 或 credential materialization。
