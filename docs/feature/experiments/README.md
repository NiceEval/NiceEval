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
- **跨 agent / 跨配置对比是一等公民。** 评 coding agent 最想要的就是"一条命令,几个配置并列出**质量 × 成本**"(见 [Observability](../../observability.md#结果可视化niceeval-view))。niceeval 用**文件夹**表达"这一组该并排比"(见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验));每个实验文件钉一个单一配置。

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
});
```

`maxConcurrency` 是**实验自己的并发闸**:调度器为这个实验单建一道信号量,它的 attempt 先过这道闸再去占全局并发位;同批跑的其它实验不受影响,仍按全局并发(CLI / env / config / 沙箱默认)跑。两个用途:把有共享状态的实验串行化(例如跨 eval 累积记忆的场景,`maxConcurrency: 1` 保证 attempt 按 eval 顺序一个个跑),或给撞了 provider 限额的实验单独降速。

experiment 只有"运行矩阵"字段,**没有 run / experiment 级整场生命周期钩子**——`ExperimentDef` 是纯配置数据,不携带任何 `setup` / `teardown` 之类的字段。但"这次实验要按配置准备什么环境"确实需要挂在某处:`sandbox` 字段拿到的 `SandboxSpec`(`dockerSandbox()` 等工厂产出)自带 `.setup(fn)` / `.teardown(fn)` 链式方法,装二进制、预热、写 hook 文件、载入/回存跨 attempt 状态都挂在这里,在沙箱创建后、变更分类账锚点前最先跑,销毁前最后收尾;这条 eval 自己的任务夹具放 `EvalDef.setup` / `test(t)`,连 agent / 装 CLI 放 `SandboxAgent.setup`,整个 run 共享的外部服务用外部编排。四类职责的完整分工见 [环境预置放哪](../sandbox/library.md#环境预置放哪)、钩子的链式写法见 [Sandbox · 沙箱生命周期钩子](../sandbox/library.md#沙箱生命周期钩子setup--teardown)。

id 从**路径**推导:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`(路径即身份,和 eval 一致,禁止手写 id);其中目录段 `compare/` 就是"可对比组",见 [Library · 实验怎么组织](library.md#实验怎么组织文件夹--一组可对比的实验)。

## 相关阅读

- [Library](library.md) —— model/flags 怎么透传、实验怎么按文件夹组织、与 config 的关系。
- [Architecture](architecture.md) —— 对照 agent-eval 的 `ExperimentConfig`,砍了什么、为什么。
- [CLI](cli.md) —— `niceeval exp` 命令。
- [Authoring](../eval/README.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Observability](../../observability.md) —— 跨 agent 的质量×成本对比与 `niceeval view`。
- [Runner](../../runner.md) —— 矩阵展开、并发、首过即停、预算的调度。
