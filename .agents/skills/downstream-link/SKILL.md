---
name: downstream-link
description: Locate and verify a NiceEval downstream consumer, and build and install the current candidate when downstream linking is authorized.
metadata:
  command: pnpm dev:link
  design: docs/engineering/repository-tools/README.md
---

# Downstream linking

Read [downstream discovery and dogfooding](references/dogfooding.md), the target repository's nearest AGENTS or README, and the [Repository Tools boundary](../../../docs/engineering/repository-tools/README.md#组合边界).

For a linking task, run `pnpm dev:link --help` for current syntax. Inspecting existing downstream results does not require building or installing a candidate.

Confirm the target repository and its existing NiceEval source before writing. When installing, build the current candidate once, verify its identity, and install only into the named downstream. Do not infer permission for paid runs, full benchmarks, result deletion, commits, or pushes.

Report the target, consumed NiceEval identity, and the smallest public-entry dogfood check that was run. Include the install result when linking was part of the task.
