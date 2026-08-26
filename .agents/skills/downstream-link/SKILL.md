---
name: downstream-link
description: Build the current NiceEval candidate and install it into an authorized downstream project for dogfooding.
metadata:
  command: pnpm dev:link
  design: docs/engineering/repository-tools/README.md
---

# Downstream linking

Read the downstream repository's nearest AGENTS or README and the [Repository Tools boundary](../../../docs/engineering/repository-tools/README.md#组合边界). Run `pnpm dev:link --help` for current syntax. Use `pnpm dev:link --check <directory>` for read-only inspection and `pnpm dev:link <directory>` to build and link the candidate.

Confirm the target repository and its existing NiceEval source before writing. Build the current candidate once, verify its identity, and install only into the named downstream. Do not infer permission for paid runs, full benchmarks, result deletion, commits, or pushes.

Report the candidate identity, target, install result, and the smallest public-entry dogfood check that was run.
