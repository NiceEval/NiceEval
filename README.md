<div align="center">

# Fast Eval

**Progressive, full-featured, excellent DX lightweight ai agent evals tool**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)
[![mintlify](https://img.shields.io/badge/mintlify-docs-5b5bd6?style=flat-square)](docs-site/docs.json)

[中文](README.zh.md)

</div>

fasteval is a general-purpose agent eval tool inspired by [eve](eve.dev). It has an excellent DX design — anyone can get started and configured in about 10 minutes. It's also very versatile: it can eval plugins, Hooks, and Skills written for Claude Code/Codex coding agents, and can directly eval your own AI Agent framework (no matter if it's based on AI SDK, LangGraph, Pi, or any other interface, it's easy to integrate).

After the eval completes, it generates readable reports and lets you view agent behavior details. Convenient for debugging and optimization.

## Architecture

fasteval supports two integration modes, depending on whether the system under test needs an isolated workspace.

**Mode 1: Sandbox (Docker) — run coding agents like Codex and Claude Code that need a sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     fasteval core    │
   │ discover·schedule·  │
   │    score·report     │
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

**Mode 2: Direct — connect straight to your own Web Agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌─────────────────────┐
   │     fasteval core    │
   │ discover·schedule·  │
   │    score·report     │
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

- **fasteval core** owns discovery, scheduling, scoring, reporting, and artifacts.
- **Agent adapters** are the open boundary: you decide how to call the system under test.
- Coding agents that need filesystem isolation run inside the **Docker Sandbox**; your own Web Agent can connect directly, without Docker.


## Example

```ts
// evals/test-image-understanding.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "Build a Button component with label and onClick props.",
  async test(t) {
    await t.send("Create src/components/Button.tsx with label and onClick props.");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
  },
});
```

```sh
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

## Quick Start

```text
READ docs-site/quickstart.mdx and install fasteval for this repo.
```

Start from the scenario that matches what you need to evaluate:

- [Claude Code / Codex plugin eval](docs-site/zh/example/claude-code-codex-plugin.mdx)
- [Claude Code / Codex skill eval](docs-site/zh/example/claude-code-codex-skill.mdx)
- [AI Agent application eval](docs-site/zh/example/ai-agent-application.mdx)


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

- [Mintlify docs site](https://fasteval.mintlify.site/)
- [Mintlify docs source](docs-site/index.mdx)
- [Documentation home](docs/README.md)
- [Getting Started](docs/getting-started.md)
- [Authoring](docs/authoring.md)
- [Scoring](docs/scoring.md)
- [Agents and Adapters](docs/agents-and-adapters.md)
- [Sandbox](docs/sandbox.md)
- [Runner](docs/runner.md)
- [Experiments](docs/experiments.md)
- [Observability](docs/observability.md)
- [CLI](docs/cli.md)
- [Source Map](docs/source-map.md)
