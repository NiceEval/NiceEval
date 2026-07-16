<div align="center">

# NiceEval

**渐进式、Agent Native、DX优秀的 AI agent evals 工具**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[English](README.md) | [Deutsch](assets/README.de.md) | [Español](assets/README.es.md) | [français](assets/README.fr.md) | [日本語](assets/README.ja.md) | [한국어](assets/README.ko.md) | [Português](assets/README.pt.md) | [Русский](assets/README.ru.md)

</div>

NiceEval 是一个 Agent 评估工具，帮助团队衡量、评估并改进生产环境中的 AI。借助 NiceEval，团队可以比较模型、迭代 Agent、发现回归问题，并利用真实用户数据持续改进 AI 应用。
 
NiceEval 以本地优先为核心：你的评估在你自己的环境中运行。当你的团队需要分享评估、回归跟踪时，可以通过 Report 上报到 BrainTrust 等平台，或者自定义的报告导出。


## 为什么有了 DeepEval、LangFuse、BrainTrust 还需要 NiceEval
NiceEval 是一个 Agent-Native 的评估工具。Dataset / golden 那一套「构建 Input 与 Expected Output」的模式，并不适合真实的 Agent 评估。
现在 Agent 需要在多轮对话、多 agent 协作、工具调用、Skill 加载等细粒度场景下进行评估，NiceEval 能做得更好。

同时，NiceEval 也能与 LangFuse、BrainTrust 共存：可以用它们做 tracing，或者把评估结果上传到两者。

## 架构

NiceEval 支持两种接入方式，取决于被测 agent 是否需要隔离的沙箱文件系统。

**模式一：Sandbox（Docker、E2B）—— 跑 Codex、Claude Code 等需要 sandbox 的 coding agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Agent 适配器(官方)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox        │
   │   ┌────────────────────────┐ │
   │   │ Codex / Claude Code    │ │
   │   │ 需要隔离文件系统的应用     │ │
   │   └────────────────────────┘ │
   └──────────────────────────────┘
```

**模式二：直连 —— 直接连接你自己的 AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     NiceEval        │
   └─────────────────────┘
        │
        │ Agent 适配器(官方，或者自己实现)
        ▼
   ┌──────────────────────────────┐
   │       你自己的 AI Agent        │
   │   (AI SDK·LangGraph·Pi )     │ 
   └──────────────────────────────┘
```

- **NiceEval 核心** 负责发现 eval、调度运行、打分、生成报告与 artifacts。
- **Agent 适配器** 是开放的边界：你来决定如何调用被测系统。
- 需要文件系统隔离的 coding agent 走 **Docker Sandbox**；自有的 AI Agent 可以直连，无需 Docker。

## 核心概念一览

| 概念 | 一句话 |
|---|---|
| Eval | 一个测试用例：写在 `evals/*.eval.ts` 里，描述测什么。 |
| Experiment | 可签入的运行配置：决定连哪个 Adapter、什么 model、什么 flags。 |
| Adapter | 连接被测系统的适配层：实现一个 `send`，把返回翻译成标准事件流。 |
| Sandbox | 需要隔离工作区的 coding agent 才用得到；直连 Web Agent 不需要。 |
| Tier | 接入 Adapter 的三档投入：Tier 1 只接 send，Tier 2 加 OTel 换调用瀑布图，Tier 3 侵入改造做 feature A/B。 |

完整术语表见[架构概览](https://niceeval.com/docs/zh/explanation/overview)。

## 示例

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "测试 agent 在实时天气问题中正确调用工具并基于结果作答的能力",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    t.succeeded();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨/);
    });

    const second = await t.send("上海明天天气怎么样?");
    second.messageIncludes("上海");

    t.judge.autoevals
      .closedQA("助手是否基于工具返回的天气数据作答，而不是凭空编造温度？")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // 你自己写的 agent adapter，接被测 web agent

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // 用 local experiment 只跑 eval-tool-call
pnpm exec niceeval view // 查看评估结果
```

## 快速开始

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

从你的场景开始：

- [浏览可运行示例](https://niceeval.com/docs/zh/examples)
- [评估 Coding Agent 扩展](https://niceeval.com/docs/zh/examples/coding-agent-extensions)
- [自写 Adapter 评估 AI Agent 应用](https://niceeval.com/docs/zh/examples/ai-agent-application)


## Roadmap
官方适配器
- [ ] Agent 软件
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent 框架
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## 文档

- [快速开始](https://www.niceeval.com/docs/zh/tutorials/quickstart)

# 感谢
该项目受下面项目所启发或者是由AI从下面项目中学习代码所写
- [eve](https://eve.dev): 主要的 DX 与 API 受 Eve 所启发
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

感谢下列社区
- WIP
