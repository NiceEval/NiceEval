# Experiments —— 怎么跑这批 eval

一个 eval 描述**测什么**(这轮对话该发生什么、怎么算对)。一个 **experiment** 描述**怎么跑这批 eval**:用哪些 agent、跑几次、过滤哪些、预算多少。两者刻意分开。

```
evals/        # 测什么 —— agent 无关,评分逻辑都在各自的 test() 里
experiments/  # 怎么跑 —— 运行矩阵:agent × model × runs over 选定 evals
```

> 参考:eve **没有**实验概念(运行配置靠 `defineEvalConfig` + CLI flag,"experiment" 只是 Braintrust 上报名);experiment 这层参考的是 Vercel agent-eval 的 `ExperimentConfig`,但砍掉了一半字段,见 [Architecture](architecture.md)。

## 为什么要分开

- **eval 不该知道被测的是谁。** 同一条 memory eval,既要测 claude-code 也要测 codex/bub。把 agent 写死进 eval 就废了复用。
- **experiment 是可签入的运行配置。** 比一串临时 CLI flag 可复现:`niceeval exp compare` 永远跑同一组对照。
- **跨 agent / 跨配置对比是一等公民。** 每个实验文件钉一个单一配置；报告直接比较当前 Scope 里的 experiments，并读取各快照记录的 `selectedEvalIds`。目录只组织源码、生成 id 和支持 CLI 前缀选择。

## `defineExperiment` 的形状

```typescript
import { defineExperiment } from "niceeval";
import type { Agent } from "niceeval/adapter";

interface EvalDescriptor {
  id: string;
  description?: string;
  tags: readonly string[];
  environment?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export default defineExperiment({
  description?: string;                       // 人读
  agent: Agent;                              // 跑哪个 agent(adapter 实例)
  model?: string;                            // 单个模型(agent 留空);省略=原生默认。跨模型对比写多个实验文件
  reasoningEffort?: string;                  // 推理努力程度(agent 留空);省略=原生默认。经 ctx.reasoningEffort / t.reasoningEffort 透传
  flags?: Record<string, JsonValue>;        // KV 参数,透传到 ctx.flags / t.flags(见 Library);必须 JSON 可序列化——
                                            // 实验是可签入可复现的配置,函数/类实例装不进快照;解析时校验,非 JSON 值直接报错
  labels?: Record<string, string | number>; // 报告归类标注:实验在各对比轴上的坐标(如 { line: "codex", memory: "mempal" })。
                                            // 不透传 ctx / t;报告用 label() / numericLabel() 按它归类(见 Library)
  runs?: number;                             // 每个 (agent × model × eval) 跑几次(默认 1)
  earlyExit?: boolean;                        // 先过一次即停其余(默认 false,runs 默认跑满测完整通过率)
  evals?: "*" | readonly string[] | ((e: EvalDescriptor) => boolean); // 跑哪些 eval(默认 "*")
  timeoutMs?: number;                        // 单次运行超时
  sandbox?: SandboxSpec;                     // 沙箱型 Agent 在哪跑；省略时只能由 Config.sandbox 显式兜底
  budget?: number;                           // 整个实验估算成本上限($),超了停止派发
  maxConcurrency?: number;                   // 只限流本实验的 attempt,不影响同批其它实验
  setup?: (ctx: ExperimentHookContext) => void | Promise<void>;     // 实验级生命周期:整场一次、宿主机侧(见下)
  teardown?: (ctx: ExperimentHookContext) => void | Promise<void>;  // 全部 attempt 收尾后执行;setup 时点走到过才触发
});
```

`flags` 与 `labels` 的分界是**这个值会不会改变 attempt 里发生的事**:会(开关联网、注入 skill)→ `flags`,进 `ctx.flags` / `t.flags`、参与可比性配置;只是给报表归类(「这格用的记忆机制是 mempal」)→ `labels`,agent 和 eval 都看不见,改它不作废任何已有结果。声明与消费见 [Library · labels](library.md#labels声明归类坐标不进运行时)。

`maxConcurrency` 是**实验自己的并发闸**:调度器为这个实验单建一道信号量,它的 attempt 先过这道闸再去占全局并发位;同批跑的其它实验不受影响,仍按全局并发(CLI / env / config / 沙箱默认)跑。三个用途:把有共享状态的实验串行化(例如跨 eval 累积记忆的场景,`maxConcurrency: 1` 保证 attempt 按 eval 顺序一个个跑)、给撞了 provider 限额的实验单独降速,或让 `runs` + `earlyExit` 变成"过了就停、没过才跑下一次"的严格重试语义——`runs` 的多个 attempt 默认按并发闸的名额数一起派发,不等前一次出结果;闸只留一张名额时才会被挤成一个接一个跑,细节见 [Runner · 首过即停](../../runner.md#首过即停earlyexit)。

`setup` / `teardown` 是**实验级生命周期钩子对**:整场至多一次、跑在宿主机上。`setup` 在本实验第一个真正要派发的 attempt 之前执行;`teardown` 在本实验全部 attempt 收尾后执行(失败、中断也执行),当且仅当 `setup` 的时点走到过——`setup` 抛错不豁免,半路失败的现场同样要扫尾;一个 attempt 都不派发时两者都不跑。它们管「每个实验一份、所有 attempt 共享」的宿主机侧资源:起一条到内网服务的隧道、拉起本实验专用的 mock server、租一个 license。`setup` 的产物写模块级变量,`teardown` 与同文件的 agent / sandbox 钩子从闭包读——runner 不做值的中介。四层生命周期(experiment / sandbox / agent / eval)共用「成对 `setup` / `teardown`、闭包传状态」这一种形态,统一语义见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它);用法与失败语义见 [Library · 实验级共享服务](library.md#实验级共享服务setup-与-teardown)、执行语义见 [Architecture · 实验级生命周期](architecture.md#实验级生命周期setup-与-teardown)。

生命周期各层各归各位,`setup` 不替代其它层:按实验变化的**沙箱内**环境预置(装二进制、预热、写 hook 文件、载入/回存跨 attempt 状态)挂 `sandbox` 字段的 `SandboxSpec` 链式钩子(`.setup(fn)` / `.teardown(fn)`,沙箱创建后、变更分类账锚点前最先跑,销毁前最后收尾);这条 eval 自己的任务夹具放 `EvalDef.setup` / `test(t)`;连 agent / 装 CLI 放 `SandboxAgent.setup`;跨实验、这次 run 之前就该存在的资源仍用外部编排。完整分工见 [环境预置放哪](../sandbox/library.md#环境预置放哪)、沙箱钩子的链式写法见 [Sandbox · 沙箱生命周期钩子](../sandbox/library.md#沙箱生命周期钩子setup--teardown)。

`sandbox` 是整个 experiment 的单一固定 spec。一批 eval 需要不同预制环境时，eval 用 `environment` 声明需求 profile，spec 的 `environments` 表把 profile 翻译成该 provider 的具体产物——experiment 仍只有一个 spec、覆盖全部选中 eval，快照与对比横截面不因此拆分。写法见 [Library · 不同 eval 起自不同预制环境](library.md#不同-eval-起自不同预制环境)。

id 只从**路径**推导:`experiments/agents/codex/gpt-5.4.ts` → `agents/codex/gpt-5.4`(禁止手写 id)。任意深度目录都只形成 id 前缀，见 [Library · 路径只表达身份](library.md#路径只表达身份与选择)。

## 相关阅读

- [Library](library.md) —— model/flags 怎么透传、怎样选择 eval、路径怎样形成 id、与 config 的关系。
- [Architecture](architecture.md) —— 对照 agent-eval 的 `ExperimentConfig`,砍了什么、为什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Authoring](../eval/README.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Observability](../../observability.md) —— 跨 agent 的质量×成本对比与 `niceeval view`。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算的调度。
