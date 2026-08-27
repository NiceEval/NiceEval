---
name: effect-ts
description: Use when implementing, debugging, or reviewing NiceEval code whose correctness depends on Effect v4 APIs or semantics, including typed failures, Schema decoding, Scope and resource lifecycles, concurrency, retries, services, layers, or Effect-backed tests. Do not use for domain modeling, data ownership, ordinary control-flow analysis, or generic observability questions that can be answered without reasoning about Effect behavior.
---

# Effect v4 workflow

Treat this repository as an Effect v4 codebase. Keep every Effect package on the exact version declared by the repository; while v4 is an RC, do not float tags or mix RC revisions.

## Applicability gate

Use this workflow only when the task requires changing Effect code or making a claim that depends on exact Effect v4 behavior.

Do not activate it merely because:

- the inspected file imports Effect;
- the relevant implementation happens to be Effect-based;
- the task mentions Schema or observability in a product-domain sense;
- a domain or data-ownership question can be answered from payloads and write paths alone.

If removing Effect from the implementation would leave the question unchanged, handle the task without this skill.

## Establish the version and source

1. Read `package.json` and the lockfile before changing Effect code.
2. Read the installed `effect/package.json` through the workspace's package-manager resolution and require major version 4.
3. Use the installed `effect/dist/*.d.ts` and JavaScript as the first source for exact signatures and behavior. They match the installed package exactly.
4. Use the canonical `Effect-TS/effect` repository only when package source is insufficient. Prefer the exact `effect@<installed-version>` tag; use `main` only when investigating an unreleased v4 change and label that distinction.
5. Never infer RC behavior from an older beta, v3, or the archived `Effect-TS/effect-smol` repository.

If the installed declaration and JavaScript files are missing, install the locked dependencies with the repository package manager before making source-level claims. Do not create a second Effect checkout merely for routine API research.

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
2. Search the installed `effect/dist/` declarations and implementation for the exact v4 API and its types.
3. Inspect the exact-version upstream tag when tests, history, or implementation context are required.
4. Prefer the simplest v4 primitive that satisfies the contract; do not introduce an abstraction only because Effect provides one.

Always research source details for resource lifecycles, interruption, concurrency, retry timing, complex typed-error hierarchies, services/layers, and unfamiliar Schema transformations.

## Implementation rules

- Use `Effect.tryPromise` when a Promise can reject and map the rejection to a domain error.
- Use `Effect.promise` only when rejection is impossible or the boundary intentionally treats rejection as a defect.
- Model expected failures in the typed error channel; reserve defects for broken invariants and truly unexpected failures.
- Decode `unknown` at JavaScript, JSON, dynamic-import, SDK, and file-format boundaries with Schema or a complete domain guard.
- Use `Effect.gen` for readable sequential workflows. Use `Effect.fn` for reusable Effect-returning business operations when its tracing/function boundary is useful.
- Introduce `Context.Service`, services, and `Layer` only when dependency provisioning or resource lifetime benefits from them; do not wrap trivial parameter passing.
- Provide services at an outer composition edge instead of repeatedly providing them inside business logic.
- Treat v4 `Result<A, E>` as the official successor to v3 `Either<A, E>` without changing success/failure direction or domain error values.
- Schema decoding and encoding may return `Exit`; close it at the owning boundary and never leak `Cause` through an existing domain result. Use `Schema.toType` when the old code validated only the type side of a transformation.
- Audit `forkChild` startup, explicit `Deferred.await` / `Fiber.join` / `Ref.get`, flattened `Cause`, and shared Layer memoization instead of applying v3 renames mechanically.
- Avoid `any`, unsafe assertions, and casts that bypass boundary decoding.

## Effect v4 ecosystem packages

Keep `effect` and every retained Effect ecosystem package on the exact validated v4 version declared by this repository. `effect` is a peer of the published NiceEval package because its public Host and Record APIs exchange Effect and Schema values with consumers.

Do not restore packages merged into v4 core. Import platform services from `effect/*` and internal CLI/process tools from their documented `effect/unstable/*` modules. Unstable modules may be used by private repository tooling, but they must not leak from the published package's public declarations.

Install only packages required by the concrete runtime or feature. Do not add `@effect/platform-node`, `@effect/vitest`, or `@effect/opentelemetry` merely to make the dependency list look more Effect-native.

## Validation

- Run `pnpm typecheck` after Effect dependency or source changes.
- Follow `docs/engineering/testing/README.md` and the repository test-reset rules before changing tests.
- Do not add `@effect/vitest` automatically. Use it only when an authorized Effect test owner needs its clock, layer, or scoped-test facilities and its exact v4 peer version is compatible.
- Run the smallest real runtime path that exercises changed interruption, finalizer, or Promise-adaptation behavior when implementation changes go beyond a dependency-only upgrade.
