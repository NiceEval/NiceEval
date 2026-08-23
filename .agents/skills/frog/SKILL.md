---
name: frog
description: Maintain NiceEval's repository friction log. Use when checking known friction, recording a reproducible papercut, or explicitly authorized publishing and synchronization of Frog entries.
---

# Frog friction log

The repository workflow is [documented here](../../../docs/engineering/repository-capabilities/README.md#多步维护工作流). Use the pinned `pnpm frog --help` entry instead of an ambient or latest CLI.

- Run `pnpm frog list` before logging or during final DX reconciliation.
- Log only reproducible repository, API, documentation, test, or tool friction that remains worth fixing. Do not log global, system, or internal model friction.
- Put reproduction material under the created entry's `artifacts/` directory and reference it from the entry.
- Treat `pnpm frog log` as a repository write. Preserve unrelated entries and include the new entry in the task's explicit Git paths.
- Run `publish` or `sync` only when the user has authorized the corresponding GitHub mutation. A local task or permission to edit the repository does not authorize those remote actions.

Frog's managed layout and entry lifecycle remain defined by [the friction-log README](../../friction-log/README.md); do not add a hand-maintained index.
