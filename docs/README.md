# ⚡ fasteval 文档

**写得快、跑得快、看得快的 TypeScript evals 库。**

## fasteval 是什么

fasteval 是一个用 TypeScript 写的评测(evals)库。它用一套声明式的 API 让你定义"什么是好结果",然后把这套判断施加到三类被测对象上:

- **coding agent** —— 把现成的 agent CLI(Claude Code、bub、Codex…)放进沙箱里跑一个编码任务,再用测试和评分器验证它干得怎么样;
- **现成的软件 / 服务** —— 对着一个已经部署的 HTTP 接口或 agent 端点发请求,断言它的回复、工具调用、结构化输出;
- **你自己的软件** —— 在进程内直接调用你的函数 / agent,把 evals 当成"语义级单元测试"跑在 CI 里。

一句话:**fasteval 把"agent 评测"和"普通函数评测"收敛到同一套 `defineEval` + 评分器 + 运行器 + 报告器里**。"连到哪个 AI、用什么协议连"被收进一个 `Agent` 抽象(每个 agent 都是自实现的 adapter,fasteval 不定义通用协议),"沙箱型 agent 在哪里跑"则由 `Sandbox` 负责。

DX 的灵感来自 [eve.dev 的 evals](https://eve.dev/docs/evals/overview)(声明式、路径即身份、gate/soft 分层断言、LLM-as-judge);适配器与沙箱的灵感来自 Vercel 的 agent-eval(fixture = PROMPT + EVAL 测试、Docker / 三方沙箱、transcript 可观测性)。

## 为什么叫 "fast"

`fast` 指三件事,对应三种"快":

- **写得快(fast to author)** —— 一个文件一个 eval,id 由路径自动推导;`async test(t)` 线性书写,断言就地声明;数据集一行 `.map` 扇出成几十个 case。没有样板,没有回调地狱。
- **跑得快(fast to run)** —— 有界并发调度;基于指纹的结果缓存跳过已通过的 case;沙箱可复用、可预热;`earlyExit` 在第一次通过后停掉同一任务的其余重试。
- **看得快(fast to read)** —— 流式控制台输出即时反馈;结构化工件(事件流、transcript、diff、断言结果)落盘;统一的 trace 让"agent 到底干了什么"一目了然。

完整论证见 [Vision](vision.md)。

## 整体形状

```text
   你的 evals/ 目录                fasteval 核心              连到 AI(自实现的 agent)
   ----------------               --------------             ------------------------
   weather.eval.ts   --discover-->  Runner  --send-->  Agent   ┬─ 进程内 adapter (你的 agent)
   sql.eval.ts                        │                        ├─ 远程 adapter   (你的服务)
   fixtures/button.eval.ts            │                        └─ 沙箱 adapter ── Sandbox
     (test() 里手工 seed 文件)         │                           (claude-code     (docker /
                                       ▼                            codex / bub …)    三方)
                                  Scorers ── Reporters ── .fasteval/<run>/
                                  (expect / scoped /     (summary.json / 事件流 /
                                   judge / 测试)           transcript / diff)
```

- **核心(core)** 拥有对所有被测对象都一样的部分:eval 发现、断言收集、评分判决、并发调度、缓存、报告、工件落盘。
- **Agent** 是"一条连到 AI 的连接"的抽象,由 experiment 引用;**Adapter** 是它的具体实现,**由你编写**(claude-code / codex 等内置)。fasteval **不定义任何 agent 协议** —— 连你自己的服务也是你写一个 agent,URL 是它的内部配置,没有 `--url`。
- **Sandbox** 拥有"沙箱型 agent 在哪里跑、如何隔离"的全部细节(Docker、Vercel Sandbox、其它三方)。

核心从不直接 `if (agent === "claude-code")` 或 `if (sandbox === "docker")` —— 它对着接口分发。这条边界是整个设计的承重墙,详见 [Architecture](architecture.md) 和 [Vision](vision.md)。

## 快速开始

```sh
npm install -D fasteval
npx fasteval init        # 生成 evals/ 与 fasteval.config.ts
npx fasteval list        # 只检查 eval 发现
npx fasteval exp local   # 通过 experiment 运行 eval
npx fasteval exp local weather  # exp 后的位置参数 = eval id 前缀
```

> 执行 eval 必须通过 experiment:experiment 选「对着哪个 agent / model / flags 怎么跑」,`exp` 后的位置参数只筛「跑哪些 eval」。详见 [CLI](cli.md)。

最小的一个 eval:

```typescript
// evals/weather/brooklyn.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");
    t.succeeded();                          // 作用域断言:运行没失败
    t.calledTool("get_weather", { input: { city: "Brooklyn" } });
    t.check(t.reply, includes("晴"));        // 值级断言:就地评估
  },
});
```

一个沙箱里的 coding-agent eval——起始文件手工放进沙箱,没有目录约定自动发现:

```typescript
// evals/fixtures/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "实现一个 Button 组件",
  async test(t) {
    await t.sandbox.writeFiles({ "package.json": BUTTON_PACKAGE_JSON });
    await t.send("用项目现有的样式系统,在 src/components/Button.tsx 导出一个 Button 组件,接受 label 和 onClick 两个 prop,并实现 hover 态。");

    t.sandbox.fileChanged("src/components/Button.tsx");
    const src = t.sandbox.diff.get("src/components/Button.tsx");
    t.check(src, includes("label"));
    t.check(src, includes("onClick"));
  },
});
```

```sh
npx fasteval exp local fixtures/button --sandbox docker
```

完整流程见 [Getting Started](getting-started.md)。

## 接着读哪一篇

按你的意图挑:

- **建立心智模型:** [Vision](vision.md)、[Concepts(术语表)](concepts.md)、[Architecture](architecture.md)。
- **写 eval:** [Eval Authoring(编写 eval)](eval-authoring.md)、[Assertions(断言参考:作用域 + 来源)](assertions.md)、[Scoring(评分器)](scoring.md)。
- **连 AI / 接 agent:** [Agents 与 Adapters](agents-and-adapters.md)、[Sandbox](sandbox.md)。
- **跑与看:** [Experiments(实验/运行矩阵)](experiments.md)、[Lifecycle(环境起停钩子)](lifecycle.md)、[Runner(执行引擎)](runner.md)、[CLI 参考](cli.md)、[Observability(可观测性)](observability.md)。
- **规划:** [Roadmap(路线图与 MVP)](roadmap.md)。

## 关于这些文档

这些是**设计文档**:仓库目前是空的,这里写的是 fasteval 的架构与各处细节思路,作为后续实现的依据。实现写出来后,真相以代码为准;届时会补一篇 source-map,把每条文档行为映射回具体文件(参考 crabbox 的做法)。文档全部用中文书写。
