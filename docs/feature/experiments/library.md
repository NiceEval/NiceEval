# Experiments —— 库用法

model/flags 怎么透传、实验怎么按文件夹组织成可对比组,以及和 `niceeval.config.ts` 的关系。核心契约见 [README](README.md)。

## model / reasoningEffort 与 flags:agent 留空,实验决定

agent 定义里**不写死模型、不写死开关**(那样就锁死了复用)。这几样由实验给,经 `ctx` 透传:

- **`model`** —— 单个模型字符串,agent 的 `send` 从 `ctx.model` 拿;省略则不传 `--model`,用 agent CLI 的原生默认。**跨模型对比写多个实验文件**(各钉一个 model),别在一个实验里塞数组。
- **`reasoningEffort`** —— 单个推理努力程度字符串(取值由具体模型定义,如 `"low"`/`"medium"`/`"high"`),归属与 `model` 完全一致:agent 的 `send` 从 `ctx.reasoningEffort` 拿,eval 的 `test` 从 `t.reasoningEffort` 拿;省略则用 agent 原生默认。跨档位对比同样写多个实验文件。
- **`flags`** —— 任意 KV 的参数,**两处可见**:agent 的 `send`(`ctx.flags`)、eval 的 `test`(`t.flags`)。用来开关联网、注入某个 skill、或让某条 eval 只在某个参数下断言。

```typescript
// experiments/research-mode.experiment.ts
export default defineExperiment({
  agent: codexAgent(),
  model: "opus",                                    // 模型在实验给,agent 留空
  reasoningEffort: "high",                          // → ctx.reasoningEffort / t.reasoningEffort
  flags: { webResearch: true, skill: "memory-v2" }, // → ctx.flags / t.flags
  runs: 3,
});
```

参数驱动的环境差异(比如按 `flags.skill` 往沙箱注入一个 skill 文件)写在 eval 的 `test(t)` 里:`if (t.flags.skill) await t.sandbox.writeFiles({ ".agent/skill.md": loadSkill(t.flags.skill) })`——普通代码,不需要框架钩子。

详见 [Adapter · 配置归属不变量](../adapters/architecture/agent-contract.md#配置归属不变量)。

## 生命周期代码怎样向这次运行反馈

`ExperimentDef` 仍然是纯配置,不提供 `experiment.log()` 或 run 级 hook。真正执行工作的 sandbox provider、sandbox hook、eval 和 Agent Adapter 会从 runner 注入的上下文获得同一套**作用域反馈 API**:

```typescript
interface ScopedFeedback {
  progress(update: {
    message: string;
    current?: number;
    total?: number;
  }): void;

  diagnostic(input: {
    code: string;
    level: "warning" | "error";
    message: string;
    data?: Readonly<Record<string, JsonValue>>;
    dedupeKey?: string;
  }): void;
}
```

- `progress(...)` 表达**此刻正在做什么**,例如下载 3/8、恢复缓存或等待 agent 完成一轮。它是短命状态:Human profile 可以更新 active 行,Agent/CI profile 不逐条打印,也不进入最终结果。
- `diagnostic(...)` 表达**运行结束后仍应保留的问题**,例如退化到备用缓存、provider 返回异常响应或 transcript 不完整。它进入 Human、Agent、CI 的永久事件流;`dedupeKey` 用于并发 attempt 产生同一问题时去重。
- 两个方法都不接受 `phase`、`scope`、颜色、输出流或 ANSI。runner 已经知道当前回调属于 `sandbox.setup`、`eval.run` 还是 `agent.run`,并据此决定 Human active 行显示的正式阶段。
- 两个方法都不改变执行结论。要让 setup/attempt 进入 `errored`,抛出异常;要让 eval 判定失败,使用 `t.check` / `t.require` / gate 断言。`diagnostic({ level: "error" })` 只表示一条需要永久保留的错误诊断。

各入口拿到的 scope 固定,调用方不能冒充其它生命周期:

| 代码入口 | 反馈入口 | runner 绑定的 scope | 典型内容 |
|---|---|---|---|
| 自定义 `SandboxSpec.create(options)` | `options.feedback` | `sandbox.provision` | 分配实例、拉镜像、恢复 snapshot |
| `sandbox.setup/teardown` | hook `ctx.progress/diagnostic` | `sandbox.setup` / `sandbox.teardown` | 安装环境依赖、预热、回存状态 |
| `EvalDef.setup` | setup `ctx.progress/diagnostic` | `eval.setup` | 准备这条 eval 的 fixture |
| `EvalDef.test` | `t.progress/diagnostic` | `eval.run` | eval 自己执行的长步骤 |
| `Agent.setup/send/teardown` | `ctx.progress/diagnostic` | 当前 `agent.*` operation | 安装 CLI、turn/tool 进度、协议诊断 |

同一个方法在不同回调里拿到的是不同的绑定对象,不能保存后跨回调复用。下面三条消息分别属于 sandbox setup、eval run 和 agent run,runner 会把它们投影到正确阶段:

```typescript
const sandbox = e2bSandbox({ template: "niceeval-agents" }).setup(async (sandbox, ctx) => {
  ctx.progress({ message: "restoring memory cache" });
  await restoreCache(sandbox, ctx.experimentId);
});

export const evalDef = defineEval({
  async test(t) {
    t.progress({ message: "preparing hidden tests", current: 2, total: 5 });
    // ...
  },
});

export const agent = defineSandboxAgent({
  name: "my-agent",
  async send(input, ctx) {
    ctx.progress({ message: "turn 2 · running shell" });
    // ...
  },
});
```

终端最终怎样展示这些反馈由 `niceeval exp --output human|agent|ci` 决定,不是这些回调的职责。完整渲染契约见 [CLI · Attempt 阶段](cli.md#attempt-阶段)。

### 哪些会落盘、怎样回顾

反馈按用途分成三层,不能混成一份无限增长的日志:

| 信息 | 是否落盘 | 回顾入口 |
|---|---|---|
| `progress(...)` 的 message/current/total | 否;后一条覆盖前一条 | 只在运行中的 Human active 行可见 |
| runner 的正式 lifecycle phase | 是,只保存发生过的阶段与耗时 | `result.json` 的 `phases`、`niceeval show @locator` |
| `diagnostic(...)` | 是,去重并有界地写入本 attempt 的 `result.json` | `niceeval show @locator` / view Attempt 详情 |
| 未捕获异常、timeout、provider/adapter 执行失败 | 是,作为结构化 `error` 写入 `result.json` | 终端的一行摘要 → locator → `niceeval show` |
| OTel trace | 有则保存,但不是错误记录的前提 | `niceeval show @locator --execution` / view trace |

trace 不能替代 diagnostic/error:Sandbox provision 可能发生在 telemetry 建立前,teardown 可能发生在 trace 收集后,自定义 provider 也可能完全没有 tracing。`result.json` 是失败能否回顾的最低保证;trace 只回答“内部步骤怎样串起来、各花多久”。

diagnostic 是有界摘要,不是原始 SDK 日志转储。相同 `dedupeKey` 在同一 attempt 内折叠为一条并累计 `count`;`data` 只放定位所需的结构化小字段,不得放 token、完整 transcript 或无限增长的 stdout/stderr。原始 agent 行为属于 `events.json`,trace 属性属于 `trace.json`。

attempt 在 teardown、cleanup 与 sandbox stop 都结束后才封口并原子写 `result.json`,因此收尾 diagnostic 也能随 attempt 保存。cleanup/teardown diagnostic 默认不反改已经得到的 verdict;如果某个收尾动作是结果正确性的必要条件,它应抛出致命错误并由 runner 明确把 attempt 记为 `errored`,而不是只打一条 diagnostic。

## 实验怎么组织:文件夹 = 一组可对比的实验

experiment 借 next-evals-oss 的"一条件一文件",再用**文件夹**把"可比性"显式化:

```
experiments/
└─ compare/                  # 一组可对比实验:同一模型下 bub vs codex
   ├─ bub-gpt-5.4.ts         #   单一配置,文件名 = <agent>-<model>
   └─ codex-gpt-5.4.ts
```

- **文件夹 = 一组可对比的实验**;**同一文件夹下的文件才互相对比**。`niceeval exp compare` 跑整组,`niceeval view` 把同组并列。
- **文件 = 单一配置**(一个 agent × 一个 model 是最干净的情形),文件名按 `<agent>-<model>[-<feature>]` 命名。同组钉住对比轴之外的一切(如同一 model),差异才干净归因到那一个轴(agent / 记忆机制 / flags)。
- **路径即 id**:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`;目录段 `compare` 即组名。

### 一文件一配置

**一个实验文件 = 一个配置**(一个 agent × 一个 model)。要跨模型 / 跨 agent 对比,就**写多个实验文件**,各钉对照轴之外的一切(如同一 model),差异才干净归因到那一个轴。`model` 是单个字符串,不接受数组 —— 想扫多个模型,复制一份实验文件改 `model` 即可。

这样每个配置独立成文件:可命名(`<agent>-<model>[-<feature>]`)、可 diff、可单独 review,"这一组就是对照"这层意思在文件结构上就讲清楚了。两条配置汇总都按 `(agent, model)` 分组,可在 `niceeval view` 里并排。

### 例子

```typescript
// experiments/compare/bub-gpt-5.4.ts —— 对照组的一格:bub(tape on)
export default defineExperiment({
  description: "bub · gpt-5.4(tape on)",
  agent: bubAgent(),
  model: "gpt-5.4",        // 同组钉同一 model,差异归因到 agent / 记忆机制
  runs: 5,
  earlyExit: false,        // 要完整通过率分布(pass^k)
  budget: 15,
});

// experiments/compare/codex-gpt-5.4.ts —— 同组对照的另一格(只换 agent)
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: codexAgent(),
  model: "gpt-5.4",
  runs: 5,
  earlyExit: false,
  budget: 15,
});

// 想扫多个 agent/model 时,复制多个实验文件;不要在单文件里塞数组。
```

## 与 config 的关系

- **`niceeval.config.ts`(`defineConfig`)** = 项目级默认:`judge`、`reporters`、并发 / 超时、`pricing`、`sandbox`。`Config.sandbox` 必须是工厂函数产出的显式 `SandboxSpec`；experiment 的 `sandbox` 可以覆盖它。两处都没配置时，沙箱型 Agent 直接报错，不探测环境或选择内置 Provider 默认值。
- **`experiments/**/*.ts`(默认导出 `defineExperiment`)** = 一次具体运行的配置,覆盖 config 默认;按文件夹聚成可对比组(`.experiment.ts` 后缀可选,位于 `experiments/` 下即识别)。

调度项覆盖优先级(高 → 低):**CLI flag → experiment → config → 内置默认**。agent、model、flags 属于 experiment,不由 CLI 覆盖。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Architecture](architecture.md) —— 对照 agent-eval 砍了什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Sandbox](../sandbox/library.md#向运行反馈进度与诊断) —— provider 与环境 hook 的反馈示例。
- [Adapters](../adapters/library.md#向运行反馈进度与诊断) —— Agent setup/send/teardown 的反馈示例。
