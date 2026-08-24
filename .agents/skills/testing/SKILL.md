---
name: testing
description: Inspect, select, author, modify, or review NiceEval E2E and Unit test owners. Use when a change needs a test strategy, an existing test must be traced to its Feature or Use Case, or a bug requires public-entry E2E TDD.
metadata:
  command: pnpm test
  design: docs/engineering/testing/README.md
---

# Testing

Read the affected product Feature first, then the [testing contract](../../../docs/engineering/testing/README.md). Run `pnpm test --help` to inspect existing test owners and their Feature, Use Case, regression Memory, and Issue relations.

Use `test list [pattern]` to find candidates and `test show <path>` to confirm the exact owner contract. Start from the long-term user result: strengthen an existing owner with the same result, or create one minimal Journey or single-boundary E2E only when no suitable owner exists. Do not create a second test for a Bug number, implementation module, or convenient fixture.

For a Bug, obtain a red receipt through the installed public Library, CLI, HTTP, browser, or Adapter entry before changing production code. The same owner must turn green after the fix. Unit tests are allowed only after the named Feature exception explains why E2E cannot stably distinguish the erroneous algorithm and defines the minimal matrix.

Each E2E test file has one top-of-file `owner:` relation. Its Engineering owner anchor links to exactly one Feature or leaf Use Case and contains the human-readable result description. Add `regression:` only for a Problem Memory and `issue:` only for direct test provenance. Test titles and ordinary Markdown mentions do not create Trace relations.

Before authoring, follow the testing index to the portfolio, E2E form, scenario-repo layout, domain page, authoring rules, and execution command needed by this case. There is intentionally no generic `test create` scaffold: owner selection, public observation, fixture, and cleanup cannot be generated safely from a slug.

New or substantially changed deterministic owners must pass isolated repetitions, same-copy repetition, default parallel execution, single-file/title execution, and resource cleanup. Finish with `pnpm test show <path>`, the narrow E2E command, `pnpm typecheck`, and `pnpm lint`; preserve the exact receipts required by the PR template.
