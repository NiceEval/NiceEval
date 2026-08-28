---
name: testing
description: Inspect, select, author, modify, or review NiceEval E2E and Unit test owners. Use when a change needs a test strategy, an existing test must be traced to its Feature or Use Case, or a bug requires public-entry E2E TDD.
metadata:
  command: pnpm run repo docs test
  design: docs/engineering/testing/README.md
---

# Testing

Read the affected product Feature first, then the [testing contract](../../../docs/engineering/testing/README.md). Run `pnpm run repo docs test --help` to inspect existing test owners and their Feature, Use Case, regression Memory, and Issue relations. `pnpm test` remains the Unit validation command.

Use `pnpm run repo docs test inventory --help` first, then `list [pattern]` to find candidates and `show <repo-relative-path#caseId>` to confirm one exact case. Start from the long-term user result: strengthen an existing owner with the same result, or create one minimal Journey or single-boundary E2E only when no suitable owner exists. Do not create a second test for a Bug number, implementation module, or convenient fixture.

For a Bug, obtain a red receipt through the installed public Library, CLI, HTTP, browser, or Adapter entry before changing production code. The same owner must turn green after the fix. Unit tests are allowed only after the named Feature exception explains why E2E cannot stably distinguish the erroneous algorithm and defines the minimal matrix.

Treat local E2E as a small number of formal checkpoints, not an interactive debug loop. When the first public red may need localization, run that formal checkpoint with `--keep-workdir`. After the red receipt, proactively switch to short retained-scene diagnostics instead of repeatedly waiting for the Repo timeout or repeating pack/install: use `pnpm e2e diagnose test --from <summary.json> --repo <id> [--timeout-seconds 15] -- <native target args>` for a file/title, or `pnpm e2e diagnose exec --from <summary.json> --repo <id> [--timeout-seconds 15] -- <argv>` for one public command. These local-only diagnostics reuse the retained installed candidate, Testkit, environment filtering, and owned process-group cleanup, but every attempt gets a new invocation and diagnostic receipt. A diagnostic green is not an E2E pass. Once candidate bytes change, discard the old scene and obtain a new formal run; prepare each candidate only once.

Each runner-collected E2E case has a permanent `necase_...` token at the end of its visible title and one current owner in the adjacent managed sidecar. Select it as `<repo-relative-path>#<caseId>`: ID is identity and path is a stale guard. One owner contract may serve multiple cases, but links to exactly one Feature or leaf Use Case. Add regression only for a Problem Memory with formal red/green receipts; add Issue only after read-only canonical-repository, non-PR, direct-provenance verification. Use only the named owner/case/regression/issue lifecycle commands. Never hand-edit sidecars or discover tests through AST/source scanning; diagnose receipts do not satisfy formal gates.

For the executable workflow, follow the command's current `--help` instead of guessing flags:

```sh
pnpm run repo docs test inventory --help
pnpm run repo docs test owner create --help
pnpm run repo docs test case attach --help
pnpm run repo docs test regression add --help
pnpm run repo docs test issue add --help
pnpm run repo docs test case move --help
pnpm run repo docs test migrate plan --help
pnpm run repo docs test migrate apply --help
```

The normal order is inventory → owner create or reuse → case attach → zero or more regression/Issue additions → `show <path#caseId>`. A file with multiple cases repeats relation commands for each selector; never copy one file-level relation to every case. Generate the old-candidate red receipt with `pnpm e2e evidence red --help`, and generate the green plus reliability certificate with `pnpm e2e takeover --help`. Use `retire`, not physical delete, for owner, case, regression, and Issue lifecycle changes. Legacy headers use `migrate plan` followed by `migrate apply`; multi-case mappings must be explicit.

Before authoring, follow the testing index to the portfolio, E2E form, scenario-repo layout, domain page, authoring rules, and execution command needed by this case. There is intentionally no generic `test create` scaffold: owner selection, public observation, fixture, and cleanup cannot be generated safely from a slug.

New or substantially changed deterministic owners must pass isolated repetitions, same-copy repetition, default parallel execution, single-case execution, and resource cleanup. Use full local E2E only for the first public red, the fixed candidate's targeted green, and required takeover/final receipts; CI owns the final complete matrix rather than step-by-step debugging. Finish with `pnpm run repo docs test show <path#caseId>`, the narrow E2E command, `pnpm test` for required Unit validation, `pnpm typecheck`, and `pnpm lint`; preserve the exact receipts required by the PR template.
