---
name: effect-ts
description: Use when implementing, debugging, or reviewing NiceEval code whose correctness depends on Effect v3 APIs or semantics, including typed failures, Schema decoding, Scope and resource lifecycles, concurrency, retries, services, layers, or Effect-backed tests. Do not use for domain modeling, data ownership, ordinary control-flow analysis, or generic observability questions that can be answered without reasoning about Effect behavior.
---

# Effect v3 workflow

Treat this repository as an Effect v3 codebase. Do not install `effect@beta`, use v4-only `effect/unstable/*` imports, or apply v4 package-alignment rules.

## Applicability gate

Use this workflow only when the task requires changing Effect code or making a claim that depends on exact Effect v3 behavior.

Do not activate it merely because:

- the inspected file imports Effect;
- the relevant implementation happens to be Effect-based;
- the task mentions Schema or observability in a product-domain sense;
- a domain or data-ownership question can be answered from payloads and write paths alone.

If removing Effect from the implementation would leave the question unchanged, handle the task without this skill.

## Establish the version and source

1. Read `package.json` and the lockfile before changing Effect code.
2. Read `node_modules/effect/package.json` to confirm the installed version and require major version 3.
3. Use `node_modules/effect/src/` as the first source for exact signatures and behavior. It matches the installed package exactly.
4. Use the canonical `Effect-TS/effect` repository only when package source is insufficient. Prefer the exact `effect@<installed-version>` tag; use the `v3` branch only for unreleased v3 context.
5. Never use the archived `Effect-TS/effect-smol` repository for v3 validation.

If `node_modules/effect/src/` is missing, install the locked dependencies with the repository package manager before making source-level claims. Do not create a second Effect checkout merely for routine API research.

## Preserve the repository boundary

Read `docs/architecture.md` before changing a runtime boundary, then preserve these rules:

- Keep identity, selection, planning, fingerprints, and result folding pure when they do not read the outside world.
- Put file, network, process, dynamic-import, concurrency, cancellation, and resource-lifecycle work in `Effect`.
- Adapt public callbacks and Provider SDK Promises once with `Effect.tryPromise` or `Effect.promise` at their boundary.
- Run Effect only at the outer public Promise facade or result-closing boundary. Do not introduce nested `Effect.runPromise`, `runPromiseExit`, or `runSync` calls in internal modules.
- Hold acquired resources in `Effect.Scope`; use `Effect.acquireRelease`, `Effect.addFinalizer`, or an equivalent scoped primitive so failure and interruption release them.
- Preserve typed failure, defect, and interruption as separate channels until the owning result boundary closes them.

## Research in this order

1. Inspect nearby NiceEval Effect patterns and the feature contract owning the behavior.
2. Search `node_modules/effect/src/` for the exact v3 API and its types.
3. Inspect the exact-version upstream tag when tests, history, or implementation context are required.
4. Prefer the simplest v3 primitive that satisfies the contract; do not introduce an abstraction only because Effect provides one.

Always research source details for resource lifecycles, interruption, concurrency, retry timing, complex typed-error hierarchies, services/layers, and unfamiliar Schema transformations.

## Implementation rules

- Use `Effect.tryPromise` when a Promise can reject and map the rejection to a domain error.
- Use `Effect.promise` only when rejection is impossible or the boundary intentionally treats rejection as a defect.
- Model expected failures in the typed error channel; reserve defects for broken invariants and truly unexpected failures.
- Decode `unknown` at JavaScript, JSON, dynamic-import, SDK, and file-format boundaries with Schema or a complete domain guard.
- Use `Effect.gen` for readable sequential workflows. Use `Effect.fn` for reusable Effect-returning business operations when its tracing/function boundary is useful.
- Introduce `Context.Tag`, services, and `Layer` only when dependency provisioning or resource lifetime benefits from them; do not wrap trivial parameter passing.
- Provide services at an outer composition edge instead of repeatedly providing them inside business logic.
- Avoid `any`, unsafe assertions, and casts that bypass boundary decoding.

## Effect v3 ecosystem packages

Keep `effect` on the latest validated v3 release declared by this repository. Treat v4 as a separate migration.

Effect v3 `@effect/*` packages use independent version numbers. Before adding or upgrading one, inspect its peer dependencies and select a release compatible with the installed `effect` v3 version. Do not force all `@effect/*` packages to the same numeric version.

Install only packages required by the concrete runtime or feature. Do not add `@effect/platform-node`, `@effect/vitest`, or `@effect/opentelemetry` merely to make the dependency list look more Effect-native.

## Validation

- Run `pnpm typecheck` after Effect dependency or source changes.
- Follow `docs/engineering/testing/README.md` and the repository test-reset rules before changing tests.
- Do not add `@effect/vitest` automatically. Use it only when an authorized Effect test owner needs its clock, layer, or scoped-test facilities and its v3 peer dependencies are compatible.
- Run the smallest real runtime path that exercises changed interruption, finalizer, or Promise-adaptation behavior when implementation changes go beyond a dependency-only upgrade.
