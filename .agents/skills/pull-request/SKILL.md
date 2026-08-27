---
name: pull-request
description: Create, update, or validate a NiceEval pull request body. Use when a task includes drafting, applying, checking, or creating a PR; do not invoke remote mutations without the user's authorization.
metadata:
  command: pnpm pr:body
  design: docs/engineering/repository-tools/README.md
---

# NiceEval pull requests

Read [the PR template](../../../.github/PULL_REQUEST_TEMPLATE.md) as the content authority and the [Repository Tools design](../../../docs/engineering/repository-tools/README.md#组合边界) for ownership.

Run `pnpm pr:body --help` for the current init, edit, render, check, apply, and create syntax. Keep the managed draft in the worktree's Git-private draft location unless the user names another path. Do not invent a tracked draft path merely to pass `--source`, and do not edit the managed Markdown file directly.

For a new PR, use the current branch's default draft: run `pnpm pr:body init --base main`, then enter `pnpm pr:body edit --help`. Set the four Problem fields, add or replace each real Before/After/User impact case, and add every changed test through a full-source test directive. The editor emits only populated template sections and directions. Run `pnpm pr:body render` for preview and `pnpm pr:body check` for validation. After commit and push, run `pnpm pr:body create --title <title> --base main`; `create` applies the body and verifies the remote HEAD and body before returning.

Before choosing the new-PR path, check whether the current branch already has an open PR. For an existing PR, prefer its numbered draft; when none exists, `check --pr <number>` and `apply --pr <number>` reuse the current branch draft. Use `init --pr <number>` only when neither draft exists or a separate numbered draft is intentional. Finish with `check --pr <number>`, `apply --pr <number>`, and `check --pr <number> --remote`. Pass `--source` only when the user selected another empty draft path; never import an authored Markdown body.

Before a remote mutation, verify the intended diff, explicit commit paths, branch, base, title language, and user authorization. Use the compiler's local `check` before commit and push; remote comparison is opt-in through `check --remote` for an existing PR.

The PR body contains only sections with real changes. Show concrete before and after package-command behavior for contributor tooling; do not invent a NiceEval product use case for repository maintenance.
