---
name: testing
description: Inspect, select, author, modify, or review NiceEval E2E and Unit test owners. Use when a change needs a test strategy, an existing test must be traced to its Feature or Use Case, or a bug requires public-entry E2E TDD.
metadata:
  command: concord test
  design: docs/engineering/testing/README.md
---

# Testing

Run `concord --skill test` for test markers, discovery and execution, and `concord --skill fix` for the defect-fix flow; use `concord test --help` for current syntax. Read the affected product Feature first, then the [testing contract](../../../docs/engineering/testing/README.md).

For a new case, place exactly one `// @feature docs/feature/<name>/README.md` or `// @use-case docs/feature/<name>/use-case/<name>.md` marker immediately above its real static declaration; generate it with `concord test marker --contract <path>`. Keep a natural title. Start from the long-term user result: strengthen an existing owner with the same result, or create one minimal Journey or single-boundary E2E only when no suitable owner exists. Never treat source `e2e/<repo>` as an installed consumer project. Do not create a second test for a Bug number, implementation module, or convenient fixture.

For a Bug, obtain a red result through the installed public Library, CLI, HTTP, browser, or Adapter entry before changing production code. The same owner must turn green after the fix. Source calls, private artifacts, core-implementation mocks, and Unit tests cannot replace this gate. Mark the regression with `@issue docs/issues/<id>.md`, commit it before the fix, and close the Issue with `concord issue close <id> --fixed`.

Before authoring, follow the testing index to the portfolio, E2E form, scenario-repo layout, domain page, authoring rules, and execution command needed by this case. There is intentionally no generic `test create` scaffold: owner selection, public observation, fixture, and cleanup cannot be generated safely from a slug.

For E2E authoring and review, enforce the harness and structured-output gates in
[`docs/engineering/testing/architecture/e2e/README.md`](../../../docs/engineering/testing/architecture/e2e/README.md#正文与-support-边界)
and route shared mechanics through the [official Testkit](../../../docs/engineering/testing/library.md#e2e-正文准入门).
Reject local copies of exported Testkit types and `json<T>()` plus local interfaces that redefine product protocols.
If a candidate lacks a strict public decoder, add it at the product protocol authority before adding a thin Testkit method.

Locally run the minimum: for a Bug, the owner's public red and the fixed candidate's targeted green; for a new or changed owner, one targeted single-file green. Use the default `link` candidate locally (reused by package-input digest, not rebuilt when only HEAD moves) and do not run the reliability takeover locally; tarball packaging, package-boundary checks and the takeover belong to CI. CI runs the reliability takeover (isolated repetitions, same-copy repetition, default parallel, single-case, resource cleanup) for every new or substantially changed deterministic owner in the push, and owns the complete matrix. Finish with `concord check`, the narrow E2E command, `pnpm test` for required Unit validation, `pnpm typecheck`, and `pnpm lint`.

Cases that can theoretically run in parallel should be concurrent by default once their project copy, result root, ports, processes, containers, and external-state identity have separate owners. Express that decision with `test.concurrent` / `test.concurrent.each`; do not rely on file splitting or an implicit global mode. Validate their owner-local deadlines under the default parallel suite load. Do not add a Repo- or domain-wide concurrency cap to make a shared runner pass; follow the E2E execution contract and change CI placement when independently owned work causes daemon, memory, or tail-latency contention. Only the smallest region that intentionally shares mutable evidence or resources may remain serial, and the shared ownership must be evident in the test.
