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
- **跨 agent / 跨配置对比是一等公民。** 评 coding agent 最想要的就是"一条命令,几个配置并列出**质量 × 成本**"(见 [Observability](../../observability.md#结果可视化niceeval-view))。niceeval 用**文件夹**表达"这一组该并排比"(见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验));每个实验文件钉一个单一配置。默认 `niceeval show` / `view` 只在同一文件夹内部比较，不把不同组混进同一张图或榜单。

## `defineExperiment` 的形状

```typescript
import { defineExperiment } from "niceeval";
import type { Agent } from "niceeval/adapter";

export default defineExperiment({
  description?: string;                       // 人读
  agent: Agent;                              // 跑哪个 agent(adapter 实例)
  model?: string;                            // 单个模型(agent 留空);省略=原生默认。跨模型对比写多个实验文件
  reasoningEffort?: string;                  // 推理努力程度(agent 留空);省略=原生默认。经 ctx.reasoningEffort / t.reasoningEffort 透传
  flags?: Record<string, JsonValue>;        // KV 参数,透传到 ctx.flags / t.flags(见 Library);必须 JSON 可序列化——
                                            // 实验是可签入可复现的配置,函数/类实例装不进快照;解析时校验,非 JSON 值直接报错
  runs?: number;                             // 每个 (agent × model × eval) 跑几次(默认 1)
  earlyExit?: boolean;                        // 先过一次即停其余(默认 true)
  evals?: "*" | string[] | ((id: string) => boolean);  // 跑哪些 eval(默认 "*")
  timeoutMs?: number;                        // 单次运行超时
  sandbox?: SandboxSpec;                     // 沙箱型 Agent 在哪跑；省略时只能由 Config.sandbox 显式兜底
  budget?: number;                           // 整个实验估算成本上限($),超了停止派发
  maxConcurrency?: number;                   // 只限流本实验的 attempt,不影响同批其它实验
  setup?: (ctx) => void | Cleanup | Promise<void | Cleanup>;  // 实验级生命周期:整场一次、宿主机侧;
                                            // 返回的 cleanup 在本实验全部 attempt 收尾后执行(见下)
});
```

`maxConcurrency` 是**实验自己的并发闸**:调度器为这个实验单建一道信号量,它的 attempt 先过这道闸再去占全局并发位;同批跑的其它实验不受影响,仍按全局并发(CLI / env / config / 沙箱默认)跑。两个用途:把有共享状态的实验串行化(例如跨 eval 累积记忆的场景,`maxConcurrency: 1` 保证 attempt 按 eval 顺序一个个跑),或给撞了 provider 限额的实验单独降速。

`setup` 是**实验级生命周期钩子**:整场一次、跑在宿主机上——本实验第一个真正要派发的 attempt 之前执行,返回的 cleanup 在本实验全部 attempt 收尾后执行(失败、中断也执行)。它管「每个实验一份、所有 attempt 共享」的宿主机侧资源:起一条到内网服务的隧道、拉起本实验专用的 mock server、租一个 license。之所以是「setup 返回 teardown」而不是两个独立字段:teardown 只在 setup 真正跑过之后才有意义,返回式注册天然绑定这层因果——setup 半路失败时该回收什么,由 setup 自己在抛错前处理,不存在「teardown 收到一个不完整现场」的形态。用法与失败语义见 [Library · 实验级共享服务](library.md#实验级共享服务setup-与它返回的-teardown)、执行语义见 [Architecture · 实验级生命周期](architecture.md#实验级生命周期setup-与它返回的-teardown)。

生命周期各层各归各位,`setup` 不替代其它层:按实验变化的**沙箱内**环境预置(装二进制、预热、写 hook 文件、载入/回存跨 attempt 状态)挂 `sandbox` 字段的 `SandboxSpec` 链式钩子(`.setup(fn)` / `.teardown(fn)`,沙箱创建后、变更分类账锚点前最先跑,销毁前最后收尾);这条 eval 自己的任务夹具放 `EvalDef.setup` / `test(t)`;连 agent / 装 CLI 放 `SandboxAgent.setup`;跨实验、这次 run 之前就该存在的资源仍用外部编排。完整分工见 [环境预置放哪](../sandbox/library.md#环境预置放哪)、沙箱钩子的链式写法见 [Sandbox · 沙箱生命周期钩子](../sandbox/library.md#沙箱生命周期钩子setup--teardown)。

`sandbox` 是整个 experiment 的单一固定 spec。一批 eval 需要不同预制环境时，eval 用 `environment` 声明需求 profile，spec 的 `environments` 表把 profile 翻译成该 provider 的具体产物——experiment 仍只有一个 spec、覆盖全部选中 eval，快照与对比横截面不因此拆分。写法见 [Library · 不同 eval 起自不同预制环境](library.md#不同-eval-起自不同预制环境)。

id 从**路径**推导:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`(路径即身份,和 eval 一致,禁止手写 id);其中目录段 `compare/` 就是"可对比组",见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验)。

## 相关阅读

- [Library](library.md) —— model/flags 怎么透传、实验怎么按文件夹组织、与 config 的关系。
- [Architecture](architecture.md) —— 对照 agent-eval 的 `ExperimentConfig`,砍了什么、为什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Authoring](../eval/README.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Observability](../../observability.md) —— 跨 agent 的质量×成本对比与 `niceeval view`。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算的调度。
