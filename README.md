<div align="center">

# fasteval

**Lightweight TypeScript agent evals for every project.**

[![typescript](https://img.shields.io/badge/typescript-5.6-blue?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](package.json)
[![docs](https://img.shields.io/badge/docs-readable-111827?style=flat-square)](docs/README.md)

[中文](README.zh.md) · [Docs](docs/README.md)

</div>

fasteval is a TypeScript evals library for testing agents and coding-agent
fixtures with one `defineEval` surface, while keeping the adapter boundary open
for services and functions.

Write small evals next to your project, run them against named agents, and get
verdicts, traces, costs, diffs, transcripts, and artifacts without building a
bespoke harness every time.

```ts
// evals/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "Build a Button component with label and onClick props.",
  workspace: "fixtures/button",
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

## Architecture

fasteval supports two wiring modes, depending on whether the system under test
needs an isolated workspace.

**Mode 1: Sandbox (Docker) — run coding agents like Codex and Claude Code that need a sandbox**

```text
   evals/*.eval.ts
        │
        ▼
   ┌──────────────────────────┐
   │       fasteval core       │
   │ discover·schedule·score·  │
   │          report           │
   └──────────────────────────┘
        │
        │ Agent adapter
        ▼
   ┌──────────────────────────────┐
   │        Docker Sandbox         │
   │   ┌────────────────────────┐  │
   │   │ Codex / Claude Code /  │  │
   │   │ apps needing isolation │  │
   │   └────────────────────────┘  │
   └──────────────────────────────┘
```

**Mode 2: Direct — connect straight to your own web agent**

```text
   evals/*.eval.ts
        │
        ▼
   ┌──────────────────────────┐
   │       fasteval core       │
   │ discover·schedule·score·  │
   │          report           │
   └──────────────────────────┘
        │
        │ Agent adapter
        ▼
   ┌──────────────────────────────┐
   │       your own web agent      │
   │  (HTTP / AI SDK·LangGraph·Pi  │
   │   stack — no Docker needed)   │
   └──────────────────────────────┘
```

- **fasteval core** owns discovery, scheduling, scoring, reporting, and artifacts.
- **Agent adapters** are the open boundary: you decide how to call the system
  under test.
- Coding agents that need filesystem isolation run inside the **Docker
  Sandbox**; your own web agent can connect directly, without Docker.

## Why fasteval

Agent evals should be cheap enough to keep beside the code they protect.
fasteval keeps the surface small:

- **One eval shape:** use `defineEval` for agent conversations and coding-agent
  tasks, with the same scoring vocabulary across both.
- **Named agents:** run the same evals against local, staging, production, or
  competing agents with `--agent <name>`.
- **Adapter-owned protocols:** fasteval does not force a universal HTTP schema.
  Your adapter decides how to talk to the system under test.
- **Sandboxed coding tasks:** run coding agents inside Docker-backed workspaces,
  capture diffs, run validation tests, and inspect transcripts.
- **Readable scoring:** combine value matchers, scoped assertions, Vitest
  checks, and optional LLM-as-judge scoring.
- **Artifacts by default:** every run can leave structured results, event
  streams, traces, diffs, usage, cost estimates, and a local viewer.

The boundary is deliberate: core owns discovery, scheduling, scoring, reporting,
and artifacts; `Agent` adapters own how to call the target; `Sandbox` backends
own where isolated work runs.

## Install

```sh
npm install -D fasteval
```

For local development in this repository:

```sh
pnpm install
pnpm run typecheck
```

## Quick Start

Register at least one sandbox agent in `fasteval.config.ts`. The adapter is
where you install and invoke the coding-agent CLI, then normalize its transcript
into fasteval events.

```ts
// fasteval.config.ts
import { defineConfig } from "fasteval";
import codex from "./agents/codex.ts";

export default defineConfig({
  agents: [codex],
  defaultAgent: "codex",
  sandbox: "docker",
  maxConcurrency: 4,
  timeoutMs: 600_000,
});
```

Add an eval:

```ts
// evals/button.eval.ts
import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

export default defineEval({
  description: "Build a Button component with label and onClick props.",
  workspace: "fixtures/button",
  async test(t) {
    await t.send("Create src/components/Button.tsx with label and onClick props.");

    t.succeeded();
    t.fileChanged("src/components/Button.tsx");
    t.check(t.file("src/components/Button.tsx"), includes("onClick"));
    t.testsPassed();
    t.noFailedShellCommands();
  },
});
```

Run it:

```sh
npx fasteval button --agent codex --sandbox docker --dry
npx fasteval button --agent codex --sandbox docker
npx fasteval view
```

Positionals select **which evals** to run. Flags select **which agent** and
**how** to run. Agent names, URLs, and runtime details do not become positional
arguments; keep them inside the adapter or environment.

## What The Adapter Does

A sandbox adapter is intentionally small: install the CLI, provide credentials,
run the prompt, and parse the transcript. The shared helpers exported by
`fasteval` and the examples in the docs cover the boring parts, such as
capturing JSONL transcripts and turning them into standard events.

```ts
// agents/codex.ts
import { defineSandboxAgent, shared } from "fasteval";

export default defineSandboxAgent({
  name: "codex",
  async setup(sandbox) {
    await shared.ensureInstalled(sandbox, "npm", ["install", "-g", "@openai/codex"]);
  },
  async send(input, ctx) {
    const run = await ctx.sandbox.runCommand("codex", ["exec", "--json", input.text], {
      stream: true,
    });
    const parsed = shared.parseCodex(run.stdout);
    return {
      status: run.exitCode === 0 ? "completed" : "failed",
      events: parsed.events,
      usage: parsed.usage,
    };
  },
});
```

Your real adapter can add model flags, resume support, custom auth, OTLP tracing,
or provider-specific transcript lookup. The core stays the same.

## Common Commands

```sh
fasteval list                         # list discovered evals
fasteval --dry                        # show what would run
fasteval <id-prefix> --agent <name>   # run matching eval ids
fasteval exp [group-or-id]            # run checked-in experiment configs
fasteval view                         # open the local artifact viewer in your browser
fasteval view --no-open               # start the viewer and only print the URL
fasteval view --out report.html       # export a static HTML report
fasteval clean                        # remove .fasteval/ artifacts
```

Useful run flags include `--agent`, `--sandbox`, `--model`, `--runs`,
`--max-concurrency`, `--timeout`, `--strict`, `--quiet`, and `--dry`.

## Experiments

Checked-in experiments let you compare agents, models, and run settings without
moving scoring rules out of the evals.

```ts
// experiments/button.ts
import { defineExperiment } from "fasteval";

export default defineExperiment({
  agent: ["codex-local", "codex-ci"],
  evals: ["button"],
  runs: 5,
  earlyExit: true,
});
```

```sh
npx fasteval exp button
```

## Reporting

The console gives immediate verdicts. The artifact reporter writes structured
run data under `.fasteval/` for `fasteval view`. You can also add reporters in
config:

```ts
import { defineConfig } from "fasteval";
import { Json, JUnit } from "fasteval/reporters";

export default defineConfig({
  reporters: [
    Json(".fasteval/results.json"),
    JUnit(".fasteval/junit.xml"),
  ],
});
```

## Agent Init Guide

To ask an AI coding agent to initialize fasteval in another repository, give it
this prompt:

```text
Read https://raw.githubusercontent.com/CorrectRoadH/fasteval/refs/heads/main/INIT.md and initialize fasteval for this repository.
```

The guide tells the agent to inspect the target repo, choose a useful first
eval, create `fasteval.config.ts`, register an adapter, add a minimal eval, run
a dry check, and leave readable docs.

## Concepts

**Eval** is a TypeScript file that describes correct behavior. The eval id comes
from the path, so `evals/weather/brooklyn.eval.ts` becomes `weather/brooklyn`.

**Agent** is a named connection to the system under test. A sandbox adapter
decides how to invoke a coding-agent CLI and returns normalized events.

**Sandbox** is where isolated coding-agent work runs. Docker is the implemented
backend; other backends can sit behind the same interface.

**Scoring** combines value assertions, scoped assertions over the event stream,
Vitest validation, and optional LLM-as-judge checks.

**Artifacts** make failures inspectable: transcript, event stream, diff,
assertions, usage, cost estimate, and trace data can all be retained.

## Roadmap

- Shorter onboarding with `fasteval init`, templates, and example adapters.
- Maintained adapter packs for common coding-agent CLIs.
- Full remote and in-process runner support for `defineAgent` workflows.
- Watch mode, fingerprint caching, changed-only reruns, and force reruns.
- More sandbox backends, including Vercel Sandbox and project-owned providers.
- More complete CI flags for JSON/JUnit output, budgets, tags, and smoke runs.
- Deeper `fasteval view` inspection for transcripts, traces, diffs, and
  experiment comparisons.

## Documentation

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

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run site:build
```

When changing `src/` or `bin/`, run `pnpm run typecheck`. When changing the
product site, run `pnpm run site:build`. CLI behavior should be smoked from a
fixture or target repository that has `fasteval.config.ts`.
