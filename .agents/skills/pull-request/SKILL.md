---
name: pull-request
description: Create, update, or validate a NiceEval pull request body. Use when a task includes drafting, applying, checking, or creating a PR; do not invoke remote mutations without the user's authorization.
---

# NiceEval pull requests

Read [the PR template](../../../.github/PULL_REQUEST_TEMPLATE.md) as the content authority and the [repository capability design](../../../docs/engineering/repository-capabilities/README.md#多步维护工作流) for ownership.

Run `pnpm pr:body --help` for the current init, render, check, apply, and create syntax. Keep the draft in the worktree's Git-private draft location unless the user names another path.

Before a remote mutation, verify the intended diff, explicit commit paths, branch, base, title language, and user authorization. Use the compiler's local `check --no-remote` before commit and push. After the intended HEAD is pushed, use `create` for a new PR or `apply` for an existing PR, then run the remote check described by command help.

The PR body contains only sections with real changes. Show concrete before and after package-command behavior for contributor tooling; do not invent a NiceEval product use case for repository maintenance.
