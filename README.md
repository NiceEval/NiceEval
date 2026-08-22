<div align="center">

# NiceEval

**Progressive, agent-native evals tool for AI agents, with excellent DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](packages/niceeval/tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)
[![discord](https://img.shields.io/badge/discord-join%20chat-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/yTMdZjFFJ)

[中文](README.zh.md) | [Deutsch](assets/README.de.md) | [Español](assets/README.es.md) | [français](assets/README.fr.md) | [日本語](assets/README.ja.md) | [한국어](assets/README.ko.md) | [Português](assets/README.pt.md) | [Русский](assets/README.ru.md)

</div>

NiceEval is an agent eval tool that helps teams measure, evaluate, and improve AI in production. With NiceEval, teams can compare models, iterate on agents, catch regressions, and keep improving their AI applications using real user data.

NiceEval is local-first at its core: your evals run in your own environment. When your team needs to share evals or track regressions, you can push a Report to platforms like BrainTrust, or export a custom report.

## Why NiceEval when DeepEval, LangFuse, and BrainTrust already exist

NiceEval is an Agent-Native eval tool. The Dataset / golden pattern of building an Input and an Expected Output doesn't fit real agent evaluation.
Agents today need to be evaluated at a finer grain — multi-turn conversations, multi-agent collaboration, tool calls, skill loading — and NiceEval does this better.

It also coexists with LangFuse and BrainTrust: use them for tracing, or upload eval results to both.

## Architecture

NiceEval supports two integration modes, depending on whether the agent under test needs an isolated sandbox filesystem.

**Mode 1: Sandbox (Docker, E2B) — run coding agents like Codex and Claude Code that need a sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agent adapter (official)
        ▼
   ┌────────────────────────────────┐
   │         Docker Sandbox         │
   │    ┌────────────────────────┐  │
   │    │ Codex / Claude Code    │  │
   │    │ apps needing isolation │  │
   │    └────────────────────────┘  │
   └────────────────────────────────┘
```

**Mode 2: Direct — connect straight to your own AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌────────────┐
   │  NiceEval  │
   └────────────┘
        │
        │ Agent adapter (official, or your own implementation)
        ▼
   ┌──────────────────────────┐
   │    your own AI Agent     │
   │   (AI SDK·LangGraph·Pi)  │
   └──────────────────────────┘
```

- **NiceEval core** owns discovery, scheduling, assertions, reporting, and artifacts.
- **Agent adapters** are the open boundary: you decide how to call the system under test.
- Coding agents that need filesystem isolation run inside the **Docker Sandbox**; your own AI agent can connect directly, without Docker.

## Core concepts at a glance

| Concept | In one line |
|---|---|
| Eval | A test case: written in `evals/*.eval.ts`, describing what to check. |
| Experiment | A checked-in run configuration: which Adapter, which model, which flags. |
| Adapter | The layer that connects to the system under test: implement one `send`, get back a standard event stream. |
| Sandbox | Only needed for coding agents that require an isolated workspace; a direct web agent doesn't need one. |
| Tier | Three levels of Adapter integration effort: Tier 1 wires up `send` only, Tier 2 adds OTel for a call waterfall, Tier 3 makes invasive changes for feature A/B testing. |

See the full glossary in the [architecture overview](https://niceeval.com/docs/concepts/overview).

## Example

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";
import { includes, jsonMatch, pattern, toolMatch } from "niceeval/expect";

export default defineEval({
  judge: true,
  description: "Verify the agent calls the weather tool and answers from its result",

  async test(t) {
    const turn = await t.send("What's the weather in Beijing today?");
    turn.succeeded();

    await t.group("calls get_weather with the right city", () => {
      turn.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "Beijing" }) }));
      t.check(turn.message, pattern(/°C|sunny|cloudy|rain/));
    });

    const second = await t.send("What about Shanghai tomorrow?");
    t.check(second.message, includes("Shanghai"));

    turn.judge.autoevals
      .closedQA("Does the reply use the tool's weather data instead of making up a temperature?")
      .gate(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // your agent adapter, pointed at the system under test

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "gpt-5.5"
});
```

```sh
pnpm exec niceeval exp local eval-tool-call  // run only eval-tool-call under the local experiment
pnpm exec niceeval view // view eval results
```

## Quick Start

```text
READ https://niceeval.com/INIT.md and set up niceeval for this repo: install it, integrate it with this project, and run the first eval end to end.
```

Start from the scenario that matches what you need to evaluate:

- [Claude Code / Codex plugin eval](https://niceeval.com/docs/example/claude-code-codex-plugin)
- [Claude Code / Codex skill eval](https://niceeval.com/docs/example/claude-code-codex-skill)
- [AI Agent application eval](https://niceeval.com/docs/example/ai-agent-application)


## Roadmap
Official Adapters
- [ ] Agent Software
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [x] OpenCode
  - [x] Hermes Agent
  - [x] OpenClaw
  - [ ] Alma
  - [ ] ...

- [ ] Agent Frameworks
  - [x] AI SDK
  - [x] Claude SDK
  - [x] Codex SDK
  - [x] Pi Agent SDK
  - [ ] LangGraph
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentation

- [Quickstart](https://niceeval.com/docs/quickstart)

# Acknowledgements
This project was inspired by — or had its code learned by AI from — the projects below:
- [eve](https://eve.dev): the main DX and API inspiration
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Thanks to [Linux.do](https://linux.do/) for their support and feedback during the project's early development.
