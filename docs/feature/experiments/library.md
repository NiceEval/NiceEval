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

## 不同 eval 起自不同预制环境

同一 experiment 可以覆盖一批运行时年代不同的真实任务：一条需要 Python 3.9 + astropy 4.2，其余用默认 Node 环境。稳定的大依赖应进 image/template/snapshot（构建工作流见 [Sandbox · 预制环境](../sandbox/library/prebuilt-environments.md)），但具体产物名属于 provider 配置，不能写死在 eval。两边用一个 provider-neutral 的 environment profile 对接：eval 声明需求，sandbox spec 的 `environments` 表把需求翻译成产物：

```typescript
// evals/memory/terminal-swe-bench-astropy-1.eval.ts —— 任务声明自己需要什么
export default defineEval({
  environment: "python-3.9-astropy-4.2",
  async test(t) { /* 上传任务、驱动 agent、跑隐藏测试 */ },
});

// experiments/shared.ts —— 一个 provider 一张翻译表，整组实验复用
export const e2b = e2bSandbox({
  template: "niceeval-agents",                 // 未声明 environment 的 eval 从它起步
  environments: {
    "python-3.9-astropy-4.2": { template: "niceeval-py39-astropy42" },
  },
});

// experiments/compare/codex.ts —— experiment 仍是单一配置，覆盖全部 eval
export default defineExperiment({ agent: codexAgent(), sandbox: e2b });
```

- `environment` 是非空、不透明的稳定 id，不是一组由 NiceEval 解释的包版本约束。
- `environments` 是纯数据：键为 profile id，值为该 provider「预制产物槽位」的覆盖参数（docker 的 `image`、e2b 的 `template`、vercel 的 `snapshotId`），字段类型由各内置工厂声明；`defineSandbox` 自定义 spec 没有这张表。详见 [Sandbox · 按 environment 选预制产物](../sandbox/library/prebuilt-environments.md#按-environment-选预制产物)。
- NiceEval 在创建任何沙箱、计算 carry 或选择全局并发前，对每条**选中** eval 完成查表；选中 eval 声明的 profile 缺表项是启动期配置错误，一次穷举列出全部 (eval id, profile) 缺项，不消耗 provider / Agent 预算。未选中 eval 的 profile 不影响本次运行。
- 查表只决定这条 attempt 从哪个预制产物起步；spec 上的 `.setup()` / `.teardown()` 钩子链与其余参数对全部 eval 共享，`EvalDef.setup` 继续只负责分类账锚点之后的任务 fixture。remote Agent 不创建 sandbox，不参与查表，`environment` 只作为 eval fingerprint 的一部分保留。

翻译表放在 spec 上而不是 experiment 上，是因为它的真实维度是 **profile × provider**，与具体实验无关：表随 spec 被多个实验共享（模块常量或 `Config.sandbox` 兜底），新增环境只改一处，experiment 保持「一行 diff」的形态，一个实验覆盖全集、对比横截面完整。

## 实验级共享服务:setup 与它返回的 teardown

「这个实验的所有 attempt 共享一份、跑在宿主机上」的资源——到内网记忆服务的隧道、每实验专用的 mock server、license 租约——写在 `ExperimentDef.setup` 里。它整场恰好至多一次:本实验第一个真正要派发的 attempt 之前执行,返回的 cleanup 在全部 attempt 收尾后执行(中断也执行);全部结果被 carry 携入时不执行。执行语义与失败语义的完整定义见 [Architecture · 实验级生命周期](architecture.md#实验级生命周期setup-与它返回的-teardown)。

```typescript
// experiments/compare/claude--nowledge.ts
import { defineExperiment } from "niceeval";
import { nowledgeAgent, nowledgeTunnel } from "../../agents/nowledge.ts";

// setup 产出的运行时坐标放模块闭包:同文件的 agent / sandbox 钩子每 attempt
// 执行、晚于 setup,直接读它;runner 不做值的中介,这些值也不进快照。
let tunnel: { url: string; apiKey: string; stop(): Promise<void> };

export default defineExperiment({
  agent: nowledgeAgent(() => ({ url: tunnel.url, apiKey: tunnel.apiKey })),
  evals: ["memory/"],
  async setup(ctx) {
    ctx.progress({ message: "starting nowledge tunnel" });
    tunnel = await nowledgeTunnel({ signal: ctx.signal });
    return () => tunnel.stop();   // teardown:全部 attempt 收尾后拆隧道
  },
});
```

隧道起失败时这个实验的每条 attempt 都记 `errored`(`experiment-setup-failed`)、逐条进报告,同批其它实验照常跑——环境起不来不该伪装成绿,也不该连坐别人。

`setup` 管的是**宿主机侧、每实验一份**的资源;别把其它层的活挪进来:沙箱内的环境预置(装二进制、预热)挂 `sandbox` spec 的链式钩子,任务夹具写 `EvalDef.setup` / `test(t)`,跨实验共享、run 之前就该存在的服务仍用外部编排(分工表见 [环境预置放哪](../sandbox/library.md#环境预置放哪))。运行时值要传给沙箱内的 agent 时,在 agent / sandbox 钩子里把闭包值写成沙箱内的 env 或配置文件——那是每 attempt 的事,发生在 `setup` 之后。

## 生命周期代码怎样向这次运行反馈

真正执行工作的实验级 setup、sandbox provider、sandbox hook、eval 和 Agent Adapter 会从 runner 注入的上下文获得同一套**作用域反馈 API**:

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

各入口拿到的 scope 固定,调用方不能冒充其它生命周期;scope 的取值就是 [Results Format 的 `LifecyclePhase`](../results/architecture.md#resultjson) 闭集成员,与落盘 `phases` / `error.phase` 同一套名字:

| 代码入口 | 反馈入口 | runner 绑定的 phase | 典型内容 |
|---|---|---|---|
| `ExperimentDef.setup` / 返回的 cleanup | setup `ctx.progress/diagnostic` | `experiment.setup` / `experiment.teardown` | 起/拆每实验一份的宿主机共享服务 |
| 自定义 `SandboxSpec.create(options)` | `options.feedback` | `sandbox.create` | 分配实例、拉镜像、恢复 snapshot |
| `sandbox.setup/teardown` | hook `ctx.progress/diagnostic` | `sandbox.setup` / `sandbox.teardown` | 安装环境依赖、预热、回存状态 |
| `EvalDef.setup` | setup `ctx.progress/diagnostic` | `eval.setup` | 准备这条 eval 的 fixture |
| `EvalDef.setup` 返回的 cleanup | cleanup `ctx.progress/diagnostic` | `eval.teardown` | 回收这条 eval 的 fixture |
| `EvalDef.test` | `t.progress/diagnostic` | `eval.run` | eval 自己执行的长步骤 |
| `Agent.setup/send/teardown` | `ctx.progress/diagnostic` | 当前 `agent.*` 阶段 | 安装 CLI、turn/tool 进度、协议诊断 |

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

trace 不能替代 diagnostic/error:沙箱创建可能发生在 telemetry 建立前,teardown 可能发生在 trace 收集后,自定义 provider 也可能完全没有 tracing。`result.json` 是失败能否回顾的最低保证;trace 只回答“内部步骤怎样串起来、各花多久”。

diagnostic 是有界摘要,不是原始 SDK 日志转储。相同 `dedupeKey` 在同一 attempt 内折叠为一条并累计 `count`;`data` 只放定位所需的结构化小字段,不得放 token、完整 transcript 或无限增长的 stdout/stderr。原始 agent 行为属于 `events.json`,trace 属性属于 `trace.json`。

实验级钩子(`ExperimentDef.setup` 与它返回的 cleanup)不属于任何单个 attempt,它的 `diagnostic(...)` 只进运行级永久事件流(Human/Agent/CI 各追加一条),不落 attempt 的 `result.json`;`setup` 抛错则以每条 attempt 的结构化 `error`(`phase: "experiment.setup"`)落盘,失败照样可回顾。

attempt 在 teardown、cleanup 与 sandbox stop 都结束后才封口并原子写 `result.json`,因此收尾 diagnostic 也能随 attempt 保存。cleanup/teardown diagnostic 默认不反改已经得到的 verdict;如果某个收尾动作是结果正确性的必要条件,它应抛出致命错误并由 runner 明确把 attempt 记为 `errored`,而不是只打一条 diagnostic。

## 实验怎么组织:文件夹 = 一组可对比的实验

experiment 借 next-evals-oss 的"一条件一文件",再用**文件夹**把"可比性"显式化:

```
experiments/
└─ compare/                  # 一组可对比实验:同一模型下 bub vs codex
   ├─ bub-gpt-5.4.ts         #   单一配置,文件名 = <agent>-<model>
   └─ codex-gpt-5.4.ts
```

- **文件夹 = 一组可对比的实验**;**同一文件夹下的文件才互相对比**。`niceeval exp compare` 跑整组,默认 `niceeval show` / `view` 按文件夹分区后只把同组配置并列；不同文件夹不共享图、连线、排序或汇总。
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

- **`niceeval.config.ts`(`defineConfig`)** = 项目级默认:`judge`、`reporters`、并发 / 超时、`pricing`、`sandbox`。`Config.sandbox` 必须是工厂函数产出的显式 `SandboxSpec`（可携带 `environments` 表）；experiment 的 `sandbox` 可以覆盖它。两处都没配置时，沙箱型 Agent 直接报错，不探测环境或选择内置 Provider 默认值。
- **`experiments/**/*.ts`(默认导出 `defineExperiment`)** = 一次具体运行的配置,覆盖 config 默认;按文件夹聚成可对比组(`.experiment.ts` 后缀可选,位于 `experiments/` 下即识别)。

调度项覆盖优先级(高 → 低):**CLI flag → 环境变量(`NICEEVAL_RUNS` / `NICEEVAL_TIMEOUT` / `NICEEVAL_BUDGET` / `NICEEVAL_MAX_CONCURRENCY`)→ experiment → config → 内置默认**。CLI 启动时加载项目根的 `.env`。agent、model、flags 属于 experiment,不由 CLI / 环境变量覆盖。

## 相关阅读

- [README](README.md) —— `defineExperiment` 的核心契约。
- [Architecture](architecture.md) —— 对照 agent-eval 砍了什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Sandbox](../sandbox/library.md#向运行反馈进度与诊断) —— provider 与环境 hook 的反馈示例。
- [Adapters](../adapters/library.md#向运行反馈进度与诊断) —— Agent setup/send/teardown 的反馈示例。
