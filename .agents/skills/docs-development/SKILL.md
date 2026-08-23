---
name: docs-development
description: Start NiceEval documentation development with the repository-owned Mint version and cache repair workflow.
metadata:
  command: pnpm docs:dev
  design: docs/engineering/repository-tools/README.md
---

# Documentation development

Read the docs-site [owner instructions](../../../apps/docs-site/AGENTS.md) and the [Repository Tools boundary](../../../docs/engineering/repository-tools/README.md#七个领域). Run `pnpm docs:dev --help` for current syntax.

The command may repair only the repository-defined Mint cache before starting the pinned development server. Do not broaden cache deletion or replace the pinned version with an ambient CLI. Stop the owned child process before ending the task.
