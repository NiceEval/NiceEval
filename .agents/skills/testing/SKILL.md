---
name: testing
description: Inspect, select, author, modify, or review NiceEval E2E and Unit test owners. Use when a change needs a test strategy, an existing test must be traced to its Feature or Use Case, or a bug requires public-entry E2E TDD.
metadata:
  command: pnpm run repo docs test
  design: docs/engineering/testing/README.md
---

# Testing

Read the affected product Feature first, then the [testing contract](../../../docs/engineering/testing/README.md). Run `pnpm run repo docs test --help` to inspect existing test owners and their Feature, Use Case, regression Memory, and Issue relations. `pnpm test` remains the Unit validation command.

For repository-wide coverage or relation audits, run `pnpm run repo docs test audit --help`, then `pnpm run repo docs test audit --json`. Treat its `uncoveredUseCases`, `unassignedCases`, `missingRelations`, and `orphanedRelations` as distinct findings; do not infer or merge them from filenames or titles.

Repository tools do not own one-time data migrations, migration protocols, compatibility branches, manifests, or bridge formats. When a repository-wide legacy migration is explicitly authorized, the coordinating agent first fixes one Git-private assignment of collected semantic cases to unique IDs, then partitions disjoint E2E Repos among execution agents. Each agent writes the token at the real test declaration, keeps the sidecar at the runner-reported owner path, confirms multi-case relations by title, and preserves non-Problem history as `Regression note:`. Finish with fresh runner collection and `audit`; the assignment is work material, not a product command or durable protocol.

For one Repo or case, use `pnpm run repo docs test inventory --help` first, then `list [pattern]` to find candidates and `show <repo-relative-path#caseId>` to confirm one exact case. `inventory --repo <id> --json` finds the registered scenario Repo, makes an isolated copy, injects the candidate and Testkit when required, installs it, runs native collection, and returns a Git-private `neinv_...` ID. Never treat source `e2e/<repo>` as an installed consumer project. Start from the long-term user result: strengthen an existing owner with the same result, or create one minimal Journey or single-boundary E2E only when no suitable owner exists. Do not create a second test for a Bug number, implementation module, or convenient fixture.

For a Bug, obtain a red receipt through the installed public Library, CLI, HTTP, browser, or Adapter entry before changing production code. The same owner must turn green after the fix. Unit tests are allowed only after the named Feature exception explains why E2E cannot stably distinguish the erroneous algorithm and defines the minimal matrix.

Treat local E2E as a small number of formal checkpoints, not an interactive debug loop. When the first public red may need localization, run that formal checkpoint with `--keep-workdir`. After the red receipt, proactively switch to short retained-scene diagnostics instead of repeatedly waiting for the Repo timeout or repeating pack/install: use `pnpm e2e diagnose test --from <summary.json> --repo <id> [--timeout-seconds 15] -- <native target args>` for a file/title, or `pnpm e2e diagnose exec --from <summary.json> --repo <id> [--timeout-seconds 15] -- <argv>` for one public command. These local-only diagnostics reuse the retained installed candidate, Testkit, environment filtering, and owned process-group cleanup, but every attempt gets a new invocation and diagnostic receipt. A diagnostic green is not an E2E pass. Once candidate bytes change, discard the old scene and obtain a new formal run; prepare each candidate only once.

Each runner-collected E2E case has a permanent `necase_...` token at the end of its visible title and one current owner in the adjacent managed sidecar. Select it as `<repo-relative-path>#<caseId>`: ID is identity and path is a stale guard. One owner contract may serve multiple cases, but links to exactly one Feature or leaf Use Case. Add regression only for a Problem Memory with formal red/green receipts; add Issue only after read-only canonical-repository, non-PR, direct-provenance verification. Use only the named owner/case/regression/issue lifecycle commands. Never hand-edit sidecars or discover tests through AST/source scanning; diagnose receipts do not satisfy formal gates.

For the executable workflow, follow the command's current `--help` instead of guessing flags:

```sh
pnpm run repo docs test inventory --help
pnpm run repo docs test owner create --help
pnpm run repo docs test case allocate-id --help
pnpm run repo docs test case attach --help
pnpm run repo docs test regression add --help
pnpm run repo docs test issue add --help
pnpm run repo docs test case move --help
```

For a new case, first run `case allocate-id --json`, append the returned `[necase_...]` token to the real visible `test(...)` title at its declaration, then run `inventory --repo <id> --json` for that scenario Repo. Create or reuse the owner, run `case attach <ownerPath#caseId> --inventory <neinv_...>` with that fresh managed inventory, add zero or more regression/Issue relations, and finish with `show <ownerPath#caseId>` plus the relevant audit. The token belongs at the declaration path; the selector and adjacent sidecar use the runner-reported owner path, which may differ when an entry test registers cases from a helper module.

Inventory JSON is private evidence, not agent work material or a versioned compatibility protocol. Never write or patch inventory files in `/tmp`, and never repair `argv`, digests, executor fields, or collection output. Commands accept only the managed ID returned by collection. `InventoryInvalid` or `InventoryStale` means collect again with the current CLI. For a repository-wide read-only decision, run `pnpm run repo docs test audit --json`; it owns the same isolated preparation and collection path without a hand-authored intermediate file.

A file with multiple cases repeats relation commands for each selector; never copy one file-level relation to every case. Generate the old-candidate red receipt with `pnpm e2e evidence red --help`, and generate the green plus reliability certificate with `pnpm e2e takeover --help`. Use `retire`, not physical delete, for owner, case, regression, and Issue lifecycle changes. Outside an explicitly authorized, coordinated repository data migration, never hand-edit sidecars or reuse an allocated ID.

Before authoring, follow the testing index to the portfolio, E2E form, scenario-repo layout, domain page, authoring rules, and execution command needed by this case. There is intentionally no generic `test create` scaffold: owner selection, public observation, fixture, and cleanup cannot be generated safely from a slug.

For E2E authoring and review, enforce the harness and structured-output gates in
[`docs/engineering/testing/e2e/README.md`](../../../docs/engineering/testing/e2e/README.md#正文与-support-边界)
and route shared mechanics through the [official Testkit](../../../docs/engineering/testing/testkit.md#e2e-正文准入门).
Reject local copies of exported Testkit types and `json<T>()` plus local interfaces that redefine product protocols.
If a candidate lacks a strict public decoder, add it at the product protocol authority before adding a thin Testkit method.

New or substantially changed deterministic owners must pass isolated repetitions, same-copy repetition, default parallel execution, single-case execution, and resource cleanup. Use full local E2E only for the first public red, the fixed candidate's targeted green, and required takeover/final receipts; CI owns the final complete matrix rather than step-by-step debugging. Finish with `pnpm run repo docs test show <path#caseId>`, the narrow E2E command, `pnpm test` for required Unit validation, `pnpm typecheck`, and `pnpm lint`; preserve the exact receipts required by the PR template.

Cases that can theoretically run in parallel should be concurrent by default once their project copy, result root, ports, processes, containers, and external-state identity have separate owners. Express that decision with `test.concurrent` / `test.concurrent.each`; do not rely on file splitting or an implicit global mode. Validate their owner-local deadlines under the default parallel suite load. Do not add a Repo- or domain-wide concurrency cap to make a shared runner pass; follow the E2E execution contract and change CI placement when independently owned work causes daemon, memory, or tail-latency contention. Only the smallest region that intentionally shares mutable evidence or resources may remain serial, and the shared ownership must be evident in the test.
