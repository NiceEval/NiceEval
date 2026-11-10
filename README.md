<div align="center">

# NiceEval

**Write evals like unit tests, compare agents like experiments**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](packages/niceeval/tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-niceeval.com-111827?style=flat-square)](https://niceeval.com/docs/introduction)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[中文](README.zh.md) | [Deutsch](assets/README.de.md) | [Español](assets/README.es.md) | [français](assets/README.fr.md) | [日本語](assets/README.ja.md) | [한국어](assets/README.ko.md) | [Português](assets/README.pt.md) | [Русский](assets/README.ru.md)

</div>

You revised a prompt, switched models, wrote a new Skill for Claude Code, or tuned the prompts for NPCs in a game. Did it actually get better?

Most of the time, the answer comes from trying it a few times and going by feel. But LLM outputs are unpredictable: the same question may get a correct answer now and a wrong one next time. Three successful attempts don't prove that a change works, or that it hasn't broken something else.

NiceEval replaces guesswork with evidence. Its main focus is agents, but it can evaluate any LLM-powered application. You describe “what counts as correct” in TypeScript: which tool to call, what a reply should contain, whether tests pass after a code change, or whether a game world remains coherent after an interaction. NiceEval connects to the system under test, runs it repeatedly, scores it, and keeps each run's conversations, tool calls, file changes, timing, and cost for comparison and investigation.

Writing evals feels like writing unit tests; using them feels more like running experiments:

- **Catch regressions**: rerun the same evals after changing a prompt, switching models, or upgrading dependencies, and check whether the pass rate drops.
- **Compare alternatives**: run the same evals against two models, two prompt versions, or with and without a Skill. See the differences in numbers and individual records.
- **Use CI**: block changes when scores fall below a threshold.
- **Grow coverage over time**: turn failures from real use into new evals that every future change will be checked against.

Everything runs on your own machine and in your CI. No account required.

## An example

Check a weather assistant: when asked about the weather, it should actually call `get_weather` instead of making up an answer.

```ts
// evals/weather-tool.eval.ts
import { defineEval, defineJudge } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

const groundedAnswer = defineJudge({
  name: "grounded-weather-answer",
  rubric: "Does the assistant answer using the tool's weather data rather than refusing or being vague?",
});

export default defineEval({
  description: "Call the weather tool and answer using its result",
  judge: groundedAnswer,

  async test(t) {
    const turn = await t.send("What's the weather in Beijing today?");
    turn.succeeded();

    // Check deterministic facts with deterministic rules
    turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
    t.check(turn.reply, pattern(/°C|temperature|sunny|cloudy|rain/));

    // The second turn should retain the context
    const second = await t.send("What about Shanghai tomorrow?");
    t.check(second.reply, includes("Shanghai"));

    // Let a judge model assess open-ended quality
    t.judge({ question: turn.input, answer: turn.reply }, groundedAnswer).gate(0.7);
  },
});
```

The Experiment specifies “which agent and which model to run,” separately from the eval cases. You can therefore use the same cases to compare two models or two prompt versions directly:

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "../agents/web-agent"; // Your own Adapter, a few dozen lines

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5",
});
```

```sh
pnpm exec niceeval exp local weather-tool   # Run only weather-tool with the local experiment
pnpm exec niceeval show                     # See results in the terminal, failures first
pnpm exec niceeval view                     # Browse conversations and tool calls in the browser
```

A complete runnable project is available in [`examples/zh/ai-sdk/`](examples/zh/ai-sdk/).

## What can you evaluate?

**Your own AI applications.** Whether built with AI SDK, LangGraph, Pi, or your own agent loop, and regardless of implementation language, they just need an interface you can call: HTTP, WebSocket, or an SDK. Write an Adapter that sends requests and translates replies into events NiceEval can read, then assert on reply content, tool calls, structured output, and usage.

**Coding agents and their extensions.** NiceEval runs agents such as Claude Code, Codex, and OpenCode in Docker or a cloud Sandbox, gives them a real repository and a task, and scores the result using the project's own tests and file changes. Use it to answer: “Does this Skill, Plugin, or memory actually help the agent do better work?”

**Any AI application, including LLM games.** The system under test doesn't have to be a conversational agent. LLM-powered games, AI social apps, and generative workflows often expose operations such as posting, replying, or NPC actions instead of back-and-forth messages. Use `defineAdapter` to expose those operations directly to eval cases. Call typed methods such as `t.post(...)` and `t.reply(...)`, check structured results and world state, and leave open-ended quality to a Judge.

```ts
// evals/social-journey.eval.ts — the system under test is an AI-powered social app
export default x.defineEval({
  description: "Post and reply, get responses from AI characters, and keep the social world coherent",
  async test(t) {
    const initial = await t.visitDiscoveryPage();
    const post = await t.post({ intent: "Invite everyone to photograph the city at night", withImage: true });
    t.check(post, authoredPost(initial.viewerId)).label("The post belongs to the current player");

    const reply = await t.reply({ postId: post.id, intent: "Add the meeting point at the riverside path entrance" });
    const responses = await t.waitForReplies(reply.id);
    t.check(responses.length, greaterThan(0)).label("AI characters respond");
    t.check(worldMaterial(await t.refreshFeed()), coherentSocialWorld()).label("Social relationships remain intact after refresh");
  },
});
```

See [`examples/zh/llm-x/`](examples/zh/llm-x/) for a complete AI-powered social app project. Its evals cover posting, replying, AI character responses, refreshing the timeline, and generating accompanying images.

## Why not just use DeepEval, LangFuse, or Braintrust?

DeepEval is a mature Python evaluation framework with a rich metric library. NiceEval makes different tradeoffs:

- **Native TypeScript**: evals, Adapters, and Experiments are typed TS code, written in the same language as your agent.
- **Assert on the process**: completing a task often takes multiple conversation turns, tool calls, file reads, and code changes. The final answer is only one part. NiceEval asserts directly on these facts without requiring a golden dataset first.
- **Score in real environments**: coding agents run in Docker or cloud Sandboxes and are scored using the project's tests and file changes, beyond just their replies.
- **Comparative experiments are first-class**: eval cases are separate from the choice of system under test, so the same cases can compare models, prompts, and extensions directly.

Observability platforms such as LangFuse and Braintrust answer “what happened in production”; evals answer “is this behavior good enough?” NiceEval focuses on the latter and the local development loop of writing evals, running them, inspecting results, and improving the agent. They can coexist: keep using those platforms for production traces and send NiceEval results to Braintrust.

## Quick start

The fastest way to get started is to ask the coding agent you already use to integrate NiceEval. Send it this:

```text
Read https://niceeval.com/INIT.md, install and integrate niceeval into the current repository, and run the first eval case end to end.
```

To do it yourself, follow the [quickstart](https://niceeval.com/docs/tutorials/quickstart) and write three files. You can see your first result in about ten minutes.

## Documentation

- [Introduction](https://niceeval.com/docs/introduction): what NiceEval is and when to use it
- [Quickstart](https://niceeval.com/docs/tutorials/quickstart): run your first eval case
- [Runnable examples](https://niceeval.com/docs/examples): integration projects for AI SDK, Claude SDK, Codex SDK, Pi, and LangGraph
- [Evaluate coding agent extensions](https://niceeval.com/docs/examples/coding-agent-extensions): measure the effects of Skills and Plugins with comparative experiments

## Official adapters

- Coding agents: Claude Code, Codex, Bub, OpenCode, Hermes Agent, OpenClaw; Alma is planned
- Agent frameworks: AI SDK, Claude SDK, Codex SDK, Pi Agent SDK, LangGraph; vm0 and Cursor Agent SDK are planned

## Acknowledgements

This project was inspired by the projects below, and some code was written by AI learning from them:

- [eve](https://eve.dev): the main inspiration for DX and API design
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Thanks to [Linux.do](https://linux.do/) for their support and feedback during the project's early development.
