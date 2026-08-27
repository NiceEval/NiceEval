---
name: effect-ts
description: Use when implementing, debugging, or reviewing NiceEval code whose correctness depends on Effect APIs or semantics, including typed failures, Schema, Scope, concurrency, services, layers, or Effect-backed tests. Do not use for domain questions that can be answered without Effect-specific reasoning.
---

# Effect workflow

Follow the [official Effect skill](https://github.com/Effect-TS/skills/tree/main/skills/effect-ts): learn Effect from the guidance shipped with the exact installed package, not from a copied API summary in this skill.

## Load the official guidance first

Before writing or changing Effect code:

1. Identify the owning workspace package and inspect its `package.json` together with the root lockfile.
2. Resolve that workspace's installed `effect/package.json`, for example with `pnpm --filter <workspace> exec node -p "require.resolve('effect/package.json')"`.
3. Require Effect major version 4 and keep every retained `effect` / `@effect/*` package on the exact repository-pinned RC revision.
4. Read the resolved package's sibling `AGENTS.md` **completely**. Follow its relative links into `ai-docs/` and `src/` when the current topic requires them; read large linked guides such as `SCHEMA.md` in relevant chunks.
5. Use the installed package source as the authority for exact signatures and behavior. Escalate to the canonical `Effect-TS/effect` repository only when needed, preferring the exact installed-version tag over `main`.

If dependencies are absent, install the locked workspace dependencies first. Do not float `beta` / RC tags, mix RC revisions, or infer current behavior from v3, an older beta, or `effect-smol`.

## NiceEval boundaries

Read `docs/architecture.md` before changing a runtime boundary. Keep pure planning and result folding outside Effect when they do not read the outside world; keep I/O, concurrency, cancellation, and resource lifetime inside Effect. Run Effect only at the owning public Promise or process boundary, preserve typed failures until their domain result boundary, and scope acquired resources so failure and interruption release them.

`effect` remains an exact peer of the published NiceEval package because public Host and Record APIs exchange Effect and Schema values with consumers. Modules under `effect/unstable/*` may support private tooling, but must not leak through published declarations.

For an actual v3-to-v4 migration, also read `../effect-v3-to-v4/SKILL.md`; do not keep migration-only symbol mappings in this ongoing Effect skill.

## Validation

Run `pnpm typecheck` after Effect dependency or source changes, then run the smallest real runtime path covering any changed interruption, finalizer, concurrency, or Promise-adaptation behavior. Follow the repository testing skill before changing test owners.
