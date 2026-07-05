<div align="center">

# NiceEval

**Progressive, agent-native evals tool for AI agents, with excellent DX**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[中文](README.zh.md) | [Deutsch](assets/README.de.md) | [Español](assets/README.es.md) | [français](assets/README.fr.md) | [日本語](assets/README.ja.md) | [한국어](assets/README.ko.md) | [Português](assets/README.pt.md) | [Русский](assets/README.ru.md)

</div>

NiceEval is an agent-native eval tool inspired by [eve](https://eve.dev). It has an excellent DX design — anyone can get started and configured in about 10 minutes. It's also versatile: it can eval plugins, Hooks, and Skills written for Claude Code/Codex coding agents, and can directly eval your own AI agent application or framework (AI SDK, LangGraph, Pi, or any custom agent loop).

After the eval completes, it generates readable reports and lets you view agent behavior details. Convenient for debugging and optimization.

## Why NiceEval when DeepEval, LangFuse, and BrainTrust already exist

NiceEval is an AI-native eval tool. In tools built around Dataset/golden-style Input vs. Expected Output, that shape doesn't fit real agent evaluation well. NiceEval is built for evaluating agents at a finer grain — multi-turn conversations, multi-agent setups, tool calls, skill loading, and more.

It also coexists with LangFuse and BrainTrust: use them for tracing, or upload eval results to both (in progress).

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
   │    │ Codex / Claude Code /  │  │
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
   │ (AI SDK·LangGraph·Pi and │
   │ other agent frameworks — │
   │    no Docker needed)     │
   └──────────────────────────┘
```

- **NiceEval core** owns discovery, scheduling, scoring, reporting, and artifacts.
- **Agent adapters** are the open boundary: you decide how to call the system under test.
- Coding agents that need filesystem isolation run inside the **Docker Sandbox**; your own AI agent can connect directly, without Docker.


## Example

Running an eval takes two files: the eval itself (what to check) and an experiment (which agent to run it against). The CLI won't run a bare eval id — the experiment in `niceeval exp <experiment> <eval prefix>` is what picks the system under test. Here's a real eval against a directly-connected web agent (full project in [`examples/zh/ai-sdk/`](examples/zh/ai-sdk/)), checking that the agent calls a tool for live weather questions and answers from the tool result instead of making it up:

```ts
// evals/eval-tool-call.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "Verify the agent calls the weather tool and answers from its result",

  async test(t) {
    const turn = await t.send("What's the weather in Beijing today?");
    t.succeeded();

    await t.group("calls get_weather with the right city", () => {
      t.calledTool("get_weather", { input: { city: "Beijing" } });
      t.messageIncludes(/°C|sunny|cloudy|rain/);
    });

    const second = await t.send("What about Shanghai tomorrow?");
    second.messageIncludes("Shanghai");

    t.judge.autoevals
      .closedQA("Does the reply use the tool's weather data instead of making up a temperature?")
      .atLeast(0.7);
  },
});
```

```ts
// experiments/local.ts
import { defineExperiment } from "niceeval";
import { webAgent } from "./adapter"; // your agent adapter, pointed at the system under test

export default defineExperiment({
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
});
```

```sh
npx niceeval exp local eval-tool-call  // run only eval-tool-call under the local experiment
npx niceeval view
```

For coding agents that need an isolated workspace (Codex, Claude Code plugins/skills), see [`examples/zh/coding-agent-skill/`](examples/zh/coding-agent-skill/): evals there use `t.sandbox.uploadDirectory()` to seed the workspace, `t.fileChanged()` / `t.file()` to check what changed, and `t.sandbox.runCommand()` to run tests.

## Quick Start

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

Start from the scenario that matches what you need to evaluate:

- [Claude Code / Codex plugin eval](https://niceeval.com/docs/zh/example/claude-code-codex-plugin)
- [Claude Code / Codex skill eval](https://niceeval.com/docs/zh/example/claude-code-codex-skill)
- [AI Agent application eval](https://niceeval.com/docs/zh/example/ai-agent-application)


## Roadmap
Official Adapters
- [ ] Agent Software
  - [x] Claude Code
  - [x] Codex
  - [x] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
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
[eve](https://eve.dev)
[agent eval](https://github.com/vercel-labs/agent-eval)
[ponytail](https://github.com/DietrichGebert/ponytail)

Thanks to the following communities
