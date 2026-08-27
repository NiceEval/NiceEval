---
name: effect-v3-to-v4
description: Use when migrating a codebase from Effect v3 to Effect v4, upgrading effect or any @effect/* package across the v3/v4 boundary.
---

# Effect v3 to v4 migration

This is NiceEval's repository-local adaptation of the [official Effect migration skill](https://github.com/Effect-TS/skills/tree/main/skills/effect-v3-to-v4). Drive every rename, removal, and signature change from upstream migration data; do not guess replacements.

## Workflow

1. Set up and validate the canonical v4 and v3 reference checkouts described below.
2. Read `.repos/effect/MIGRATION.md` once and list `.repos/effect/migration/` for the guide index.
3. Migrate package manifests first: remove consolidated packages and align every retained Effect package on one exact v4 version.
4. Run the repository typecheck to obtain the initial error inventory.
5. For each error, search `migration/v3-to-v4.md` for the exact symbol, then escalate through the topic guide and exact source as needed. Never silence an error instead of resolving it.
6. Finish only after typecheck is clean; run the relevant tests and report their outcome honestly.

## Canonical reference checkouts

Use two shallow, single-branch clones of the canonical Effect repository:

```sh
git clone --depth 1 --single-branch https://github.com/Effect-TS/effect .repos/effect
git clone --depth 1 --single-branch --branch v3 https://github.com/Effect-TS/effect .repos/effect-v3
```

- `.repos/effect` is v4 `main` and owns `MIGRATION.md`, `migration/`, and v4 source.
- `.repos/effect-v3` is the v3 escalation-only reference.

Validate any existing checkout before trusting it:

```sh
git -C .repos/effect remote get-url origin
node -p "require('./.repos/effect/packages/effect/package.json').version"
```

The origin must be `Effect-TS/effect` and the version must be 4.x. A stale `effect-smol` checkout is not a valid migration source. These reference clones are not NiceEval development worktrees; do not create or switch NiceEval branches or worktrees for the migration.

## Lookup order

1. Read `.repos/effect/MIGRATION.md` once.
2. Search `.repos/effect/migration/v3-to-v4.md` for each changed import or API. Never read this roughly 16,000-line generated reference whole.
3. Read a relevant `.repos/effect/migration/*.md` topic guide when the mapping implies a structural rewrite.
4. Read v4 source under `.repos/effect/packages/*/src/` to confirm the replacement's exact signature.
5. Read `.repos/effect-v3` only when old semantics remain unclear.

Useful searches:

```sh
rg -n 'AnthropicTokenizer\.layer' .repos/effect/migration/v3-to-v4.md
rg -n -A 40 '^### `@effect/platform/FileSystem`' .repos/effect/migration/v3-to-v4.md
rg -n '^@effect/platform/FileSystem ' .repos/effect/migration/v3-to-v4.md
rg -n '^### `@effect/cluster/' .repos/effect/migration/v3-to-v4.md
```

A miss in the import map is not final: also inspect the removed-modules and no-counterpart-imports sections.

## Repository-level changes

- Remove packages merged into v4 core, including `@effect/platform`, `@effect/rpc`, and `@effect/cluster`, and rewrite imports according to the upstream map.
- Keep packages that remain separate, such as `@effect/platform-*`, `@effect/sql-*`, `@effect/ai-*`, `@effect/opentelemetry`, and `@effect/vitest`.
- Align `effect` and every retained `@effect/*` dependency on the same exact v4 version.
- Use mapped `effect/unstable/*` imports where v4 requires them; treat their APIs as unstable.

## NiceEval worker rules

For large, independent migration slices, use only the Herdr worker workflow authorized by the root `AGENTS.md`. Never use built-in or custom subagents, never give two workers overlapping write sets, and never let a worker replace the parent agent's error inventory, diff review, or validation. Small migrations stay with the primary agent.

## Hard prohibitions

- Do not introduce a v3-shaped compatibility layer.
- Do not use `any` or `as` casts to hide migration errors.
- Do not invent replacement APIs; every replacement must trace to the generated reference, a topic guide, or v4 source.

## Done condition

The repository typechecks against v4. Run relevant tests without weakening them, and report typecheck, test results, constructed replacements, and any unresolved gaps.
