---
name: consumer-link
description: Build the current NiceEval candidate and install it into an authorized downstream repository for dogfooding.
metadata:
  command: pnpm consumer:link
  design: docs/engineering/repository-tools/README.md
---

# Consumer linking

Read the downstream repository's nearest AGENTS or README and the [Repository Tools boundary](../../../docs/engineering/repository-tools/README.md#七个领域). Run `pnpm consumer:link --help` for current syntax.

Confirm the target repository and its existing NiceEval source before writing. Build the current candidate once, verify its identity, and install only into the named downstream. Do not infer permission for paid runs, full benchmarks, result deletion, commits, or pushes.

Report the candidate identity, target, install result, and the smallest public-entry dogfood check that was run.
