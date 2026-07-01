# Experiments —— 怎么跑这批 eval

一个 eval 描述**测什么**(这轮对话该发生什么、怎么算对)。一个 **experiment** 描述**怎么跑这批 eval**:用哪些 agent、跑几次、过滤哪些、预算多少。两者刻意分开。

```
evals/        # 测什么 —— agent 无关,评分逻辑都在各自的 test() 里
experiments/  # 怎么跑 —— 运行矩阵:agent × model × runs over 选定 evals
```

> 参考:eve **没有**实验概念(运行配置靠 `defineEvalConfig` + CLI flag,"experiment" 只是 Braintrust 上报名);experiment 这层参考的是 Vercel agent-eval 的 `ExperimentConfig`,但**砍掉了一半字段**(见下)。

## 为什么要分开

- **eval 不该知道被测的是谁。** 同一条 memory eval,既要测 claude-code 也要测 codex/bub。把 agent 写死进 eval 就废了复用。
- **experiment 是可签入的运行配置。** 比一串临时 CLI flag 可复现:`fasteval exp compare` 永远跑同一组对照。
- **跨 agent / 跨配置对比是一等公民。** 评 coding agent 最想要的就是"一条命令,几个配置并列出**质量 × 成本**"(见 [Observability](observability.md#结果可视化fasteval-view))。fasteval 用**文件夹**表达"这一组该并排比"(见 [实验怎么组织](#实验怎么组织文件夹--一组可对比的实验));每个实验文件钉一个单一配置。

## `defineExperiment` 的形状

```typescript
import { defineExperiment, type Agent } from "fasteval";

export default defineExperiment({
  description?: string;                       // 人读
  agent: Agent;                              // 跑哪个 agent(adapter 实例)
  model?: string;                            // 单个模型(agent 留空);省略=原生默认。跨模型对比写多个实验文件
  flags?: Record<string, unknown>;           // feature flags,透传到 ctx.flags / t.flags(见下)
  runs?: number;                             // 每个 (agent × model × eval) 跑几次(默认 1)
  earlyExit?: boolean;                        // 先过一次即停其余(默认 true)
  evals?: "*" | string[] | ((id: string) => boolean);  // 跑哪些 eval(默认 "*")
  timeoutMs?: number;                        // 单次运行超时
  sandbox?: SandboxBackend;                  // 覆盖 config 的沙箱后端
  budget?: number;                           // 整个实验估算成本上限($),超了停止派发

  // —— 生命周期钩子:起停环境,作用域同构,详见 Lifecycle ——
  hooks?: {
    run?: {                                                          // 整轮一次:起停共享环境
      setup?(run: RunContext): Promise<void | Cleanup>;
      teardown?(run: RunContext): Promise<void>;
    };
    sandbox?: {                                                      // 每次运行:预置/清理沙箱(setup 能读 ctx.flags)
      setup?(sandbox: Sandbox, ctx: AgentContext): Promise<void | Cleanup>;
      teardown?(sandbox: Sandbox, ctx: AgentContext): Promise<void>;
    };
  };
});
```

id 从**路径**推导:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`(路径即身份,和 eval 一致,禁止手写 id);其中目录段 `compare/` 就是"可对比组",见 [下节](#实验怎么组织文件夹--一组可对比的实验)。

### model 与 flags:agent 留空,实验决定

agent 定义里**不写死模型、不写死开关**(那样就锁死了复用)。这两样由实验给,经 `ctx` 透传:

- **`model`** —— 单个模型字符串,agent 的 `send` 从 `ctx.model` 拿;省略则不传 `--model`,用 agent CLI 的原生默认。**跨模型对比写多个实验文件**(各钉一个 model),别在一个实验里塞数组。
- **`flags`** —— 任意 KV 的 feature flags,**三处可见**:agent 的 `send`(`ctx.flags`)、experiment 的 `hooks.sandbox.setup`(`ctx.flags`)、eval 的 `test`(`t.flags`)。用来开关联网、注入某个 skill、调 effort、或让某条 eval 只在某 flag 下断言。

```typescript
// experiments/research-mode.experiment.ts
export default defineExperiment({
  agent: codexAgent(),
  model: "opus",                                    // 模型在实验给,agent 留空
  flags: { webResearch: true, skill: "memory-v2" }, // → ctx.flags / t.flags
  runs: 3,
  hooks: {
    sandbox: {
      setup: async (sb, ctx) => {                    // setup 也能读 flags
        if (ctx.flags.skill) await sb.writeFiles({ ".agent/skill.md": loadSkill(ctx.flags.skill) });
      },
    },
  },
});
```

详见 [Agents 与 Adapters:三类配置的归属](agents-and-adapters.md#三类配置的归属本地配--实验传入--ctx-透传)。

## 实验怎么组织:文件夹 = 一组可对比的实验

experiment 借 next-evals-oss 的"一条件一文件",再用**文件夹**把"可比性"显式化:

```
experiments/
└─ compare/                  # 一组可对比实验:同一模型下 bub vs codex
   ├─ bub-gpt-5.4.ts         #   单一配置,文件名 = <agent>-<model>
   └─ codex-gpt-5.4.ts
```

- **文件夹 = 一组可对比的实验**;**同一文件夹下的文件才互相对比**。`fasteval exp compare` 跑整组,`fasteval view` 把同组并列。
- **文件 = 单一配置**(一个 agent × 一个 model 是最干净的情形),文件名按 `<agent>-<model>[-<feature>]` 命名。同组钉住对比轴之外的一切(如同一 model),差异才干净归因到那一个轴(agent / 记忆机制 / flag)。
- **路径即 id**:`experiments/compare/bub-gpt-5.4.ts` → `compare/bub-gpt-5.4`;目录段 `compare` 即组名。

### 一文件一配置

**一个实验文件 = 一个配置**(一个 agent × 一个 model)。要跨模型 / 跨 agent 对比,就**写多个实验文件**,各钉对照轴之外的一切(如同一 model),差异才干净归因到那一个轴。`model` 是单个字符串,不接受数组 —— 想扫多个模型,复制一份实验文件改 `model` 即可。

这样每个配置独立成文件:可命名(`<agent>-<model>[-<feature>]`)、可 diff、可单独 review,"这一组就是对照"这层意思在文件结构上就讲清楚了。两条配置汇总都按 `(agent, model)` 分组,可在 `fasteval view` 里并排。

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

## 从 agent-eval 砍掉了什么(以及为什么)

agent-eval 的 `ExperimentConfig` 字段一半是它自己业务的耦合或可下放的。fasteval 的 `defineExperiment` 只留**纯运行矩阵**:

| agent-eval 字段 | fasteval | 处置 | 理由 |
|---|---|---|---|
| `agent` | `agent` | 保留,但一文件一个 agent | 沿用 agent;文件夹表达"可比组"(见 [实验怎么组织](#实验怎么组织文件夹--一组可对比的实验)) |
| `model` / `runs` / `earlyExit` / `evals` / `timeout` / `sandbox` / `setup` | 同(`timeout`→`timeoutMs`;`setup`→`hooks.sandbox.setup`,并补 `teardown` 与 run 作用域,见 [Lifecycle](lifecycle.md)) | 保留 | 运行矩阵的本体 |
| `validation` | — | **删** | 「怎么算对」是 eval 自己的事(`test()` 里手工跑校验命令),不该由 experiment 决定 |
| `scripts` | — | **删** | 同上,属于 eval / fixture 的评分,不是运行配置 |
| `brands` | — | **删** | Vercel 品牌追踪专用,通用 evals 不需要 |
| `editPrompt` | — | **删** | 改写 prompt 太 niche,需要时在 agent/eval 里做 |
| `onRunComplete` | — | **删** | 下游**分析**交给 [reporter](observability.md#reporters),避免两套钩子;**资源起停**另由 [生命周期钩子](lifecycle.md)(`hooks.run.teardown` / `hooks.sandbox.teardown`)负责 —— 两者正交,见 [资源 vs 分析](lifecycle.md#不和-reporter-冲突--资源-vs-分析) |
| `modelPolicy` | — | **删** | 折进「`model` 省略 = 原生默认」 |
| `copyFiles` | — | **删(挪 config)** | 工件拷贝是全局行为,放 `defineConfig`,不必每实验配 |
| `webResearch` / `agentOptions` | `flags` | **合并** | 一个通用 feature-flag 袋取代散落的开关,经 `ctx.flags` / `t.flags` 透传 |
| — | `budget` | **加** | 实验级成本上限,接 [用量与成本](observability.md#用量与成本token--计费) |

一句话:**experiment 只管"跑什么、跑几次、花多少",不碰"怎么算对"。** 评分细节全在 eval。

## 与 config 的关系

- **`fasteval.config.ts`(`defineConfig`)** = 项目级默认:默认 sandbox、`judge`、`reporters`,以及项目级的[生命周期钩子](lifecycle.md)(`hooks.run` / `hooks.sandbox`,实验的同名钩子叠加在其上)。
- **`experiments/**/*.ts`(默认导出 `defineExperiment`)** = 一次具体运行的配置,覆盖 config 默认;按文件夹聚成可对比组(`.experiment.ts` 后缀可选,位于 `experiments/` 下即识别)。

调度项覆盖优先级(高 → 低):**CLI flag → experiment → config → 内置默认**。agent、model、flags 属于 experiment,不由 CLI 覆盖。

## CLI

```sh
fasteval exp                       # 跑 experiments/ 下全部实验
fasteval exp compare               # 跑某一组(文件夹 compare/ 内全部配置,互为对照)
fasteval exp compare/bub-gpt-5.4   # 跑组里某一个配置
fasteval exp compare memory/retention  # 再用 eval id 前缀缩小到部分 eval
```

不写实验不能运行 eval。临时验证也写一个小的 `experiments/local.ts`;要换 agent 或 model,复制一个 experiment 文件改配置。

## 相关阅读

- [Authoring](eval-authoring.md) —— eval 怎么写(experiment 跑的就是它们)。
- [Lifecycle](lifecycle.md) —— `hooks.run` / `hooks.sandbox` 的 `setup` / `teardown`:环境起停的完整模型。
- [Observability](observability.md) —— 跨 agent 的质量×成本对比与 `fasteval view`。
- [Runner](runner.md) —— 矩阵展开、并发、早停、预算的调度。
- [CLI](cli.md) —— `exp` 与全部标志。
