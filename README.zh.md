<div align="center">

# NiceEval

**给 AI Agent 和 AI 应用写评估，像写单元测试一样顺手**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](packages/niceeval/tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-niceeval.com-111827?style=flat-square)](https://niceeval.com/docs/zh/introduction)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[English](README.md) | [Deutsch](assets/README.de.md) | [Español](assets/README.es.md) | [français](assets/README.fr.md) | [日本語](assets/README.ja.md) | [한국어](assets/README.ko.md) | [Português](assets/README.pt.md) | [Русский](assets/README.ru.md)

</div>

你改了一版 prompt，换了一个模型，给 Claude Code 写了一个新 Skill，或者调了游戏里 NPC 的提示词。它到底变好了没有？

NiceEval 用来回答这个问题。它以 Agent 为主要场景，也能评任何由 LLM 驱动的应用。你用 TypeScript 写下“什么算做对”：该调用哪个工具、回复里该有什么、代码改完测试能不能过、游戏世界在一轮互动后是否还自洽。NiceEval 负责连上被测对象、反复运行、打分，再把每一次运行的对话、工具调用、文件改动、耗时和花费都留下来，供你对比和追查。

所有东西都在你自己的机器和 CI 里跑，不需要注册账号。

## 一个例子

验证一个天气助手：问天气时它要真的调用 `get_weather`，而不是凭空编一个答案。

```ts
// evals/weather-tool.eval.ts
import { defineEval, defineJudge } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

const groundedAnswer = defineJudge({
  name: "grounded-weather-answer",
  rubric: "助手是否基于工具返回的天气数据作答，而不是拒绝或含糊其辞？",
});

export default defineEval({
  description: "问天气时调用工具，并基于工具结果作答",
  judge: groundedAnswer,

  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.succeeded();

    // 确定的事实用确定的规则检查
    turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));
    t.check(turn.message, pattern(/°C|气温|晴|多云|雨/));

    // 第二轮要接得上上下文
    const second = await t.send("那上海明天呢？");
    t.check(second.message, includes("上海"));

    // 开放式的质量交给裁判模型
    t.judge({ question: turn.input, answer: turn.message }, groundedAnswer).gate(0.7);
  },
});
```

“对着哪个 Agent、用哪个模型跑”写在 Experiment 里，和评估用例分开。同一批评估用例因此可以直接拿来比较两个模型或两版 prompt：

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "../agents/web-agent"; // 你自己写的 Adapter，几十行

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5",
});
```

```sh
pnpm exec niceeval exp local weather-tool   # 用 local 实验只跑 weather-tool
pnpm exec niceeval show                     # 在终端看结果，失败的排在前面
pnpm exec niceeval view                     # 在浏览器里逐条翻对话和工具调用
```

完整可运行的项目在 [`examples/zh/ai-sdk/`](examples/zh/ai-sdk/)。

## 能评什么

**你自己的 AI 应用。** 不管它基于 AI SDK、LangGraph、Pi 还是自研的 Agent loop，也不管它用什么语言写，只要有一个能调用的接口（HTTP、WebSocket、SDK 都行）。你写一个 Adapter，把请求发过去、把回复翻译成 NiceEval 能读的事件，就能断言回复内容、工具调用、结构化输出和用量。

**Coding Agent 和它的扩展。** NiceEval 把 Claude Code、Codex、OpenCode 等 Agent 放进 Docker 或云端 Sandbox，给它一个真实的仓库和任务，最后用项目自己的测试和文件改动来判分。适合回答“装了这个 Skill / Plugin / memory 之后，Agent 是不是真的更会干活”。

**任何 AI 应用，比如 LLM 游戏。** 被测对象不一定是对话式 Agent。LLM 驱动的游戏、AI 社交应用、生成式工作流，提供的往往是“发帖”“回复”“NPC 行动”这类业务操作，而不是一来一回的消息。你用 `defineAdapter` 把这些操作原样交给评估用例，评估里直接调用带类型的 `t.post(...)`、`t.reply(...)`，检查返回的结构化结果和世界状态，开放式的质量再交给 Judge。

```ts
// evals/social-journey.eval.ts —— 被测对象是一个 AI 驱动的社交应用
export default x.defineEval({
  description: "发帖、回复后，AI 角色作出回应，社交世界保持自洽",
  async test(t) {
    const initial = await t.visitDiscoveryPage();
    const post = await t.post({ intent: "邀请大家今晚一起拍摄城市夜景", withImage: true });
    t.check(post, authoredPost(initial.viewerId)).label("帖子属于当前玩家");

    const reply = await t.reply({ postId: post.id, intent: "补充集合地点在河边步道入口" });
    const responses = await t.waitForReplies(reply.id);
    t.check(responses.length, greaterThan(0)).label("AI 角色作出回应");
    t.check(worldMaterial(await t.refreshFeed()), coherentSocialWorld()).label("刷新后社交关系仍完整");
  },
});
```

完整项目见 [`examples/zh/llm-x/`](examples/zh/llm-x/)：一个 AI 驱动的社交应用，评估覆盖发帖、回复、AI 角色回应、刷新时间线和生成配图。

## 为什么不直接用 DeepEval、LangFuse、Braintrust

准备一份输入和标准答案再逐条比对，这套做法适合问答。但 Agent 做对一件事，往往要经过多轮对话、几次工具调用、读文件、改代码，最终答案只是其中一环。NiceEval 的断言直接落在这些过程事实上，不要求你先攒一份 golden 数据集。

LangFuse、Braintrust 更偏线上 tracing 和监控。NiceEval 专注“写评估、跑评估、看结果、改 Agent”这一段本地开发循环。两者可以共存：你继续用它们看线上 trace，也可以把 NiceEval 的结果上报给 Braintrust。

## 快速开始

最快的方式是让你正在用的 Coding Agent 帮你接入。把下面这句话发给它：

```text
阅读 https://niceeval.com/INIT.md，为当前仓库安装并接入 niceeval，端到端跑通第一条评估用例。
```

想自己动手，按[快速开始](https://niceeval.com/docs/zh/tutorials/quickstart)写三个文件，十分钟左右就能看到第一条结果。

## 文档

- [介绍](https://niceeval.com/docs/zh/introduction)：NiceEval 是什么、适合什么场景
- [快速开始](https://niceeval.com/docs/zh/tutorials/quickstart)：跑通第一条评估用例
- [可运行示例](https://niceeval.com/docs/zh/examples)：AI SDK、Claude SDK、Codex SDK、Pi、LangGraph 的接入项目
- [评估 Coding Agent 扩展](https://niceeval.com/docs/zh/examples/coding-agent-extensions)：用对照实验衡量 Skill 和 Plugin 的效果

## 官方适配器

- Coding Agent：Claude Code、Codex、Bub、OpenCode、Hermes Agent、OpenClaw；Alma 计划中
- Agent 框架：AI SDK、Claude SDK、Codex SDK、Pi Agent SDK、LangGraph；vm0、Cursor Agent SDK 计划中

## 致谢

这个项目受下面这些项目启发，部分代码由 AI 从中学习写成：

- [eve](https://eve.dev)：主要的 DX 与 API 设计受 eve 启发
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

感谢 [Linux.do](https://linux.do/) 在项目早期给予的支持与反馈。
