---
title: 'e2e 场景目录本地 typecheck 与 vitest 因 registry 包与候选 API 漂移而误导'
severity: 'minor'
---

## Expected Behavior

Scenario repos (`e2e/*`) should give a trustworthy local `pnpm exec tsc --noEmit` / vitest when their checked-in lockfile is installed.

## Current Behavior

The lockfile installs the published `niceeval` (e.g. 0.12.0) whose API differs from the repo's current candidate (0.4.6, injected by the root runner). Local typecheck then reports errors that are the inverse of the candidate reality (`defineAgent` missing, `openRecord` present, `agentWorkspaceDiffProjector` missing…) and hides real gaps. Only a candidate-injected check is representative.

## Possible Solution

Document that scenario typecheck is only meaningful through `pnpm e2e`; or add a script that typechecks with tsconfig `paths` pointing at the repo `src` subpath entries (`niceeval`, `niceeval/expect`, `niceeval/record`, `niceeval/analysis`, `niceeval/projection`, `niceeval/adapter`, `niceeval/sandbox`).

## Minimal Reproducible Example

1. `cd e2e/eval && pnpm install` (checkout state).
2. `pnpm exec tsc --noEmit` → evals/agents errors about the registry API.
3. Point `node_modules/niceeval` at the repo root with the `paths` map above → different, candidate-shaped errors.

## Context

Hit during the eval E2E contract sync (2026-08-12). The registry/candidate drift cost a long misdiagnosis loop before the paths-based check was set up.
