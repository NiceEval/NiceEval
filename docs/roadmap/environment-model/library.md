# 环境层 —— 三个真实形态的库写法

模型与重构理由见 [README](README.md)。
本篇按三个真实项目形态各走一遍新契约,最后给「换成缓存产物」的第四段。
`defineLayer` 与 `experiment.layers` 是新原语;底座声明、Fixture 与 provider 选择沿用现行契约。

## 形态 1:agent 侧环境重(记忆对照 + mempal)

所有题共用轻底座,重的是条件工具。
条件在旧写法里要凑三件事:派生 template 命名(`mempalTemplate("codex")`)、`.setup()` Hook 里装二进制加预热、flags 背环境身份。
新写法一件:声明一个层。

```typescript
// experiments/shared/mempal.ts
import { defineLayer } from "niceeval/sandbox";

export const MEMPAL_VERSION = "0.9.0";

export const mempal = defineLayer({
  identity: { name: "mempal", version: MEMPAL_VERSION },
  check: async (sandbox) =>
    (await sandbox.runCommand("mempal", ["--version"])).stdout.includes(MEMPAL_VERSION),
  apply: async (sandbox, ctx) => {
    ctx.progress({ message: `installing mempal ${MEMPAL_VERSION}`, current: 1, total: 2 });
    await sandbox.runShell(MEMPAL_INSTALL_SH);
    ctx.progress({ message: "warming embedding model", current: 2, total: 2 });
    await sandbox.runCommand("mempal", ["warmup"]);   // 逐层计时会记下这步花了多久
  },
});
```

```typescript
// experiments/compare/codex--mempal.ts
export default defineExperiment({
  description: "codex · gpt-5.6-luna(mempal)",
  agent: codexAgent({ mcpServers: [mempalMcp] }),
  model: "gpt-5.6-luna",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })   // 官方基线,没烘 mempal
    .setup(mempalLoadState())      // Hook 收窄后只剩状态:载入
    .teardown(mempalSaveState()),  //                     回存
  layers: [mempal],
  flags: { memory: "mempal" },     // 只用于分组展示;环境身份由层声明承载
  maxConcurrency: 1,               // [载入…回存] 是临界区
});
```

对照条件就是没有那行 `layers` 的另一份实验文件。
消掉的东西:派生 template 的命名体操与重构建、每 attempt 无条件重装、「template 名 + flags」双轨背身份。
换 agent(claude / codex / bub)不再触发条件模板矩阵:同一个 `mempal` 层在任何底座上自检自装。

## 形态 2:题目环境重(terminal-bench)

每题自带 Compose,环境是题意的一部分。
这半边契约不变;变化在叙述上——agent CLI 的现场安装就是 adapter 自动贡献的那个层,与条件层同协议:

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
const environment = composeSandbox({
  file: new URL("docker-compose.yaml", import.meta.url),
  mainService: "client",
  build: "on-demand",
});

export default defineEval({
  environment,                     // 底座:题自己的 Compose,按需构建
  async test(t) {
    await t.send("修好 /app/solver 里的死循环。");
    await t.sandbox.uploadDirectory("./tests", ".tbench-testing");   // 判分材料收工后再挂
    const verify = await t.sandbox.runShell("bash .tbench-testing/run-tests.sh");
    t.check(verify, commandSucceeded());
  },
});
```

```typescript
// experiments/claude-docker.ts
export default defineExperiment({
  agent: claudeCodeAgent(),        // adapter 贡献 agent 层:任务镜像里检查→staged 安装→复检
  sandbox: dockerSandbox({
    materializers: { compose: dockerComposeMaterializer() },
  }),
});
```

experiment 不知道任何一道题长什么样;换 provider、换 agent 都不碰 241 份题目声明。

## 形态 3:两头都重(每题底座 × 每条件工具)

旧模型的死角:题有 241 种底座,条件工具烘进 template 就是 241 × 条件的制品矩阵。
新契约下它就是形态 2 加一行:

```typescript
// experiments/claude-docker--mempal.ts
export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: dockerSandbox({ materializers: { compose: dockerComposeMaterializer() } })
    .setup(mempalLoadState())
    .teardown(mempalSaveState()),
  layers: [mempal],                // 同一个层声明,原样复用到 241 种任务底座上
  maxConcurrency: 1,
});
```

零新增产物。
每条 attempt:题目 Compose 物化底座 → agent 层自检自装 → mempal 层自检自装 → 状态载入 → 跑题。
断网题这类底座约束由层的 apply 自己面对——staged 制品准备(在题面网络之外取制品再送入)与 agent 层同一套手段;某层在某底座上确实无法补齐时 `errored` 点名该层,不静默降级。

## 形态 4:把热路径烘进产物

逐层计时显示 mempal 的 warmup 每次要 90 秒、形态 1 的实验天天跑,这就是造缓存产物的信号:

```typescript
// 构建一次:官方 codex 基线 + mempal,用 provider 原生工具(e2b template build)
// experiments/compare/codex--mempal.ts 只改一行:
sandbox: e2bSandbox({ template: "acme/codex-mempal-0.9.0" }),
```

`layers: [mempal]` 保持不动:check 命中,apply 零执行,身份声明与「官方基线 + 现场安装」那版完全同一份。
两条如实规则照付:

- 换底座产物就是换底座身份,旧结果不携带——缓存省时间,不投机身份等价;
- template 里烘的版本落后于声明时不会静默用旧版:check 不命中,现场补齐到 `0.9.0`。

于是「要不要造 template」从架构决策降级成性能调优:先纯运行时把实验跑对,计时说话之后再决定烘什么。

## 选择速查

| 你的项目 | 底座 | 层 | 形态 |
| --- | --- | --- | --- |
| 所有题同一种环境,比 agent / 条件 | spec 默认产物 | agent 层(adapter 自带)+ 条件层 | 1 |
| 每题自带环境 | eval folder-local source / profile | agent 层 | 2 |
| 每题环境 + 每条件工具 | eval 声明 | agent 层 + 条件层 | 3 |
| 任一形态跑热了 | 烘常用层进产物,声明不动 | check 命中零动作 | 4 |

## 相关阅读

- [README](README.md) —— 层原语契约、身份规则与待裁决分歧。
- [Sandbox Case](../../feature/sandbox/case.md) —— 底座物化:folder-local source、`environments` 表、缺失判定。
- [Sandbox Library](../../feature/sandbox/library.md) —— Hook 签名与环境预置分工表(定稿后按 Hook 收窄改写)。
- [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) —— agent 层的协议原型与 staged 安装手段。
