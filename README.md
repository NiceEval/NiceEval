<div align="center">

# NiceEval

**Progressive, full-featured, excellent DX lightweight ai agent evals tool**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[中文](README.zh.md)

</div>

NiceEval is a general-purpose agent eval tool inspired by [eve](https://eve.dev). It has an excellent DX design — anyone can get started and configured in about 10 minutes. It's also very versatile: it can eval plugins, Hooks, and Skills written for Claude Code/Codex coding agents, and can directly eval your own AI Agent framework (no matter if it's based on AI SDK, LangGraph, Pi, or any other interface, it's easy to integrate).

After the eval completes, it generates readable reports and lets you view agent behavior details. Convenient for debugging and optimization.

## Architecture

NiceEval supports two integration modes, depending on whether the system under test needs an isolated sandbox filesystem.

**Mode 1: Sandbox (Docker) — run coding agents like Codex and Claude Code that need a sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     niceeval        │
   └─────────────────────┘
        │
        │ Agent adapter (official)
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox         │
   │   ┌────────────────────────┐  │
   │   │ Codex / Claude Code /  │  │
   │   │ apps needing isolation │  │
   │   └────────────────────────┘  │
   └──────────────────────────────┘
```

**Mode 2: Direct — connect straight to your own AI Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     niceeval        │
   └─────────────────────┘
        │
        │ Agent adapter (official, or your own implementation)
        ▼
   ┌──────────────────────────────┐
   │       your own Web Agent      │
   │   (HTTP / AI SDK·LangGraph·   │
   │    Pi and other frameworks —  │
   │         no Docker needed)     │
   └──────────────────────────────┘
```

- **niceeval core** owns discovery, scheduling, scoring, reporting, and artifacts.
- **Agent adapters** are the open boundary: you decide how to call the system under test.
- Coding agents that need filesystem isolation run inside the **Docker Sandbox**; your own Web Agent can connect directly, without Docker.


## Example

```ts
// evals/button-component.eval.ts
import { defineEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";

export default defineEval({
  description: "Build a Button component with label and onClick props.",
  async test(t) {
    await t.send("Create src/components/Button.tsx with label and onClick props.");

    t.succeeded();
    t.sandbox.fileChanged("src/components/Button.tsx");
    t.check(t.sandbox.file("src/components/Button.tsx"), includes("onClick"));

    const test = await t.sandbox.runCommand("npm", ["test"], { cwd: "/workspace" });
    t.check(test, commandSucceeded());
  },
});
```

```sh
npx niceeval exp codex-docker button
npx niceeval view
```

## Quick Start

```text
READ https://raw.githubusercontent.com/CorrectRoadH/niceeval/refs/heads/main/INIT.md and install niceeval for this repo.
```

Start from the scenario that matches what you need to evaluate:

- [Claude Code / Codex plugin eval](https://niceeval.com/docs/zh/example/claude-code-codex-plugin)
- [Claude Code / Codex skill eval](https://niceeval.com/docs/zh/example/claude-code-codex-skill)
- [AI Agent application eval](https://niceeval.com/docs/zh/example/ai-agent-application)


## Roadmap
Official Adapters
- [ ] Agent Software
  - [ ] Claude Code
  - [ ] Codex
  - [ ] Bub
  - [ ] OpenClaw
  - [ ] Hermess Agent
  - [ ] Alma
  - [ ] ...

- [ ] Agent Frameworks
  - [ ] AI SDK
  - [ ] LangGraph
  - [ ] Claude SDK
  - [ ] Codex SDK
  - [ ] vm0
  - [ ] Cursor Agent SDK

## Documentation

- [Mintlify docs site](https://niceeval.com/docs/)
- [Mintlify docs source](docs-site/index.mdx)
- [Documentation home](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Authoring](docs/eval-authoring.md)
- [Scoring](docs/scoring.md)
- [Agents and Adapters](docs/adapters/README.md)
- [Sandbox](docs/sandbox.md)
- [Runner](docs/runner.md)
- [Experiments](docs/experiments.md)
- [Observability](docs/observability.md)
- [CLI](docs/cli.md)
- [Source Map](docs/source-map.md)

## Acknowledgements

This project was inspired by — or had its code learned by AI from — the projects below:

- [eve](https://eve.dev)
- [agent eval](https://github.com/vercel-labs/agent-eval)
- [ponytail](https://github.com/DietrichGebert/ponytail)

Thanks to the communities behind them.
