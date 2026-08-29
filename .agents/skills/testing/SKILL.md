---
name: testing
description: Inspect, select, author, modify, or review NiceEval E2E and Unit test owners. Use when a change needs a test strategy, an existing test must be traced to its Feature or Use Case, or a bug requires public-entry E2E TDD.
metadata:
  command: pnpm run repo docs test
  design: docs/engineering/testing/README.md
---

# Testing

Read the affected product Feature first, then the [testing contract](../../../docs/engineering/testing/README.md). Run `pnpm run repo docs test --help` to discover the current managed commands rather than guessing flags.

Start from the long-term user result. Prefer an existing owner with the same result; when none qualifies, add one minimal Journey or single-boundary E2E. Do not create a second test for a Bug number, implementation module, or convenient fixture. Automated product tests must not add or restore `src/**/*.test.*` or `test/unit/**`; a Unit is allowed only after the named Feature exception establishes why E2E cannot distinguish the erroneous algorithm and defines its minimal matrix.

For a Bug, obtain a red receipt through the installed public Library, CLI, HTTP, browser, or Adapter entry before changing production code. The same owner must turn green after the fix. Source calls, private artifacts, core-implementation mocks, and Unit tests cannot replace this gate.

Choose the relevant mode and read only its reference:

- For inventory, owner selection, case attachment, regression or Issue relations, migration, retirement, and managed sidecars, read [Case ownership](references/case-ownership.md).
- Before running, diagnosing, profiling, taking over, or collecting evidence from E2E—including any work that can start Vitest, Node, Docker, Incus, a provider, or a candidate process—read [Local E2E execution](references/local-e2e-execution.md).
- For authoring or reviewing E2E bodies, fixtures, Testkit support, scenario layout, decoders, and public observations, follow the [E2E authoring contract](../../../docs/engineering/testing/e2e/README.md#正文与-support-边界) and [official Testkit](../../../docs/engineering/testing/testkit.md#e2e-正文准入门). Do not copy those contracts into this skill.

Before authoring, use the testing index to enter the relevant portfolio, E2E form, scenario Repo, product domain, and execution contract. There is intentionally no generic `test create` scaffold: owner selection, public observation, fixture, and cleanup cannot be generated safely from a slug.
