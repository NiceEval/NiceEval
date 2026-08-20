<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker-in-Docker

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes. Name the user-visible capability or behavior, not
an internal mechanism such as its registry, protocol, or storage model. Keep one
dominant outcome and aim for 72 characters or fewer. Write the PR title and
description in the language of the user's latest request.

For large PR bodies, use `pnpm pr:body --help` to create a local Markdown
draft, embed exact test sources, enforce this template, and check GitHub drift.

Keep only product-surface sections that contain a real change. Delete empty
directions and sections instead of writing "None". Under each included
direction, present every change as a named user case with a concrete Before
example, After example, and User impact. The case is the explanation: do not
replace it with prose about a "contract", implementation mechanism, or change
classification. Usage examples must begin at the public owner that consumes
the value: `defineEval()`, `defineExperiment()`, report JSX, a CLI invocation,
or a package script.

When the PR changes a NiceEval user workflow, the product-surface inventory does
not replace Use cases. Surface entries show what changed; Use cases show how a
user completes a task across the affected owners and where the workflow fails
or stops being supported. Contributor mechanics such as authoring or reviewing
a PR are not NiceEval product use cases.

Use Removed when an entry that existed at the PR base no longer exists, Added
when the final PR introduces a new entry, and Changed when the same entry exists
before and after but its shape or observable behavior changes. A replacement
with a new public identity is one Removed entry and one Added entry, not one
Changed entry. Do not add `breaking`, `additive`, `behavior-change`,
`internal-only`, or `uncertain` as a second classification model; describe
compatibility and migration concretely in User impact.

Inventory every environment variable added, removed, renamed, given a new
default, or used in a new scope. Include user-facing variables, CI secrets,
test-only switches, container injection, systemd/service variables, and
variables consumed by packaging scripts. Prefer an explicit API, CLI flag,
configuration file, argument, or constant whenever the value does not need an
ambient deployment boundary. "Convenient" is not sufficient justification for
a new environment variable.

Include the Record schema section only when the PR changes the public Record
format or a private persisted implementation. Public Record files,
attachments, envelopes, discriminators, field meanings, and public
reader/writer behavior belong to the versioned format. Private caches, indexes,
temporary files, and directory organization do not become public schema merely
because they persist; inventory their data-loss or observable impact
separately. Show persisted-data behavior as public cases: writing new data,
reading existing data, and upgrading or recovering it. A version bump must
identify the incompatible public-format result and the upgrade path. An
unchanged version must show both reader directions. Do not replace these cases
with an abstract schema checklist.

Always keep the Terminology section. Inventory terms added to or removed from
the project's preferred vocabulary, including a rename as one Removed term and
one Added term. Define each term in plain language and link its canonical entry
in `docs/concepts.md`. If terminology is unchanged, write `None` under both
directions.
-->

## Problem

- User goal: <what the user is trying to accomplish>
- Current limitation: <why the existing API or behavior cannot accomplish it safely or correctly>
- Required capability: <why the supporting API, protocol, or internal mechanism is necessary>
- User outcome: <what becomes possible after this PR>

## Use cases

<!--
Delete this entire section when the PR does not change a NiceEval product use
case. Do not turn implementation, documentation, CI, PR authoring, or review
mechanics into a user workflow merely to keep the section.

Describe complete user workflows, not API symbols. Repeat the block below for
every materially distinct user goal. Link every added or changed
`docs/**/use-case/**` leaf. Keep the canonical long example in the contract
document; the PR body must still show the smallest copyable public entry and
its observable result or diagnostic.

Across the repeated blocks, explicitly account for every applicable path:
- the minimum happy path;
- a multi-owner or multi-capability composition path;
- setup, reuse, teardown, or another lifecycle path when lifecycle changes;
- a named failure path;
- an explicitly unsupported boundary.

Write `None — <reason>` for a path that does not apply. Do not invent scenarios
to satisfy a fixed count. If one workflow covers the entire change, explain why
it also covers the relevant composition, lifecycle, failure, and unsupported
boundaries.
-->

### `<user goal>`

- Coverage: `happy path | composition | lifecycle | failure | unsupported`
- Starting point: <what the user already has>
- Copyable usage or trigger: <the smallest complete usage beginning at a public owner>
- Observable result or diagnostic: <what the user sees>
- Contract: `<docs path to the complete use case, or "no separate use-case document">`

## Public API

### Removed

#### Case: `<package entry or symbol>`

- Before usage or result: <copyable TypeScript example and observed result>
- After usage or result: `removed`
- User impact: <what stops working and the concrete migration or replacement>

### Added

#### Case: `<package entry or symbol>`

- Before usage or result: `not available`
- After usage or result: <copyable TypeScript example and observed result>
- User impact: <what becomes possible>

### Changed

#### Case: `<package entry or symbol>`

- Before usage or result: <copyable TypeScript example and observed result>
- After usage or result: <copyable replacement example and observed result>
- User impact: <compatibility and migration effects>

## CLI

### Removed

#### Case: `<command or flag>`

- Before usage or result: <copyable shell command and observed result>
- After usage or result: `removed`
- User impact: <what stops working and the concrete migration or replacement>

### Added

#### Case: `<command or flag>`

- Before usage or result: `not available`
- After usage or result: <copyable shell command and observed result>
- User impact: <stdout, stderr, exit code, JSON schema, default, or workflow effect>

### Changed

#### Case: `<command or flag>`

- Before usage or result: <copyable shell command and observed result>
- After usage or result: <the same command, or its replacement, and the observed result>
- User impact: <stdout, stderr, exit code, JSON schema, default, or migration change>

## Report components

### Removed

#### Case: `<component, prop, or report entry>`

- Before usage or result: <copyable TSX example and rendered result>
- After usage or result: `removed`
- User impact: <author migration and reader-visible effect>

### Added

#### Case: `<component, prop, or report entry>`

- Before usage or result: `not available`
- After usage or result: <copyable TSX example and rendered result>
- User impact: <authoring and reader-visible capability>

### Changed

#### Case: `<component, prop, or report entry>`

- Before usage or result: <copyable TSX example and rendered result>
- After usage or result: <copyable replacement TSX and rendered result>
- User impact: <author migration and reader-visible effect>

## Observable behavior and data contracts

### Removed

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: <concrete input and observed result>
- After usage or result: `removed`
- User impact: <effect on users, stored data, or automation and the replacement>

### Added

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: `not available`
- After usage or result: <concrete input and observed result>
- User impact: <effect on users, stored data, or automation>

### Changed

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: <concrete input and observed result>
- After usage or result: <the same input, or its replacement, and the observed result>
- User impact: <compatibility, migration, stored data, or automation effect>

## Record schema and stored-data upgrade

<!--
Delete this entire section when neither the public Record format nor a private
persisted implementation changes. Otherwise show only the applicable cases:

- Name every public persisted surface whose shape or meaning changes, including
  run/attempt metadata, events, artifacts, attachments, and envelopes. List
  private persisted implementation changes separately; they do not by
  themselves justify a public schema version bump.
- The new-write case includes the stable `format` / `schemaVersion` / `producer`
  header and changed files, attachments, references, or meanings.
- The existing-read case shows the public command or reader and its result.
- Use `N -> N` or `N -> M` in the upgrade case. Show both reader directions when
  the version stays unchanged.
- If the version changes, identify the exact incompatible field/meaning and
  link the version-history entry that records why invalidating old Records is
  necessary.
- State what happens to every existing Record: direct read, explicit migration,
  automatic migration, or rejection with the exact recovery/view command.
- The current Record contract has no cross-version migration. Under that
  contract, a real version bump must select rejection plus the producer-version
  recovery command. Explicit or automatic migration is valid only when the same
  PR first changes the canonical Record contract and implements that public
  migration boundary; the receipt cannot invent migration by itself.
- For a real migration, the upgrade case names the public trigger, preservation
  rules, atomicity, idempotence, interruption recovery, and data-loss boundary.
-->

### Case: write a new Record

- Action: <public writer or CLI command>
- Result: <literal recognition header plus changed files, attachments, fields, references, or meanings>

### Case: read an existing Record

- Action: <public reader or CLI command, including the historical producer version when needed>
- Result: <direct read, migration, or exact rejection/recovery diagnostic>

### Case: upgrade or recover stored data

- Version: `<N -> N | N -> M>`
- Before: <what happens to existing data before this PR>
- After: <what happens after this PR; include both reader directions when N -> N>
- Safety: <preservation, atomicity, idempotence, interruption recovery, and known data loss; or why no migration runs>
- User impact: <required action and observable result>
- Evidence: <Record architecture; version history when N -> M; exact public verification command and result>

### Private persisted data

<!-- Delete when private persistence is unaffected. -->

- Case: <cache, index, temporary file, or layout scenario>
- Before: <observable behavior or data-loss boundary>
- After: <observable behavior or data-loss boundary>
- User impact: <required action, recovery, or no action with concrete reason>

## Environment variables

### Removed

#### Case: `<VARIABLE_NAME>`

- Before usage or result: <copyable shell/config example and observed result>
- After usage or result: `removed`
- Environment boundary: <scope, producer, consumer, inheritance, default, precedence, validation, and secret exposure>
- User and security impact: <migration or "none">

### Added

#### Case: `<VARIABLE_NAME>`

- Before usage or result: `not available`
- After usage or result: <copyable shell/config example, default, and observed result>
- Environment boundary: <scope, producer, consumer, inheritance, precedence, validation, and secret exposure>
- Necessity: <why an explicit API, CLI flag, config file, argument, or constant cannot own this value>
- User and security impact: <workflow, default, migration, or "none">

### Changed

#### Case: `<VARIABLE_NAME>`

- Before usage or result: <copyable shell/config example, default, and observed result>
- After usage or result: <copyable shell/config example, default, and observed result>
- Environment boundary: <scope, producer, consumer, inheritance, precedence, validation, and secret exposure>
- Necessity: <why an explicit API, CLI flag, config file, argument, or constant cannot own this value>
- User and security impact: <compatibility, migration, or "none">

## Package scripts

### Removed

#### Case: `<pnpm script>`

- Before usage or result: <copyable command and observed result>
- After usage or result: `removed`
- User impact: <development, CI, documentation, or release workflow migration>

### Added

#### Case: `<pnpm script>`

- Before usage or result: `not available`
- After usage or result: <copyable command and observed result>
- User impact: <development, CI, documentation, or release workflow capability>

### Changed

#### Case: `<pnpm script>`

- Before usage or result: <copyable command and observed result>
- After usage or result: <copyable command and observed result>
- User impact: <development, CI, documentation, or release workflow change>

## Terminology

<!--
Keep this section even when terminology is unchanged. A term is a preferred
domain word recorded in docs/concepts.md, not every new identifier in source.
For a rename, list the old term under Removed and the replacement under Added.
-->

### Added terms

#### Case: `<new preferred term>`

##### Before

```md
<a concrete sentence using the previous wording, or `No preferred term.`>
```

##### After

```md
<the same sentence rewritten with the new preferred term>
```

In one short paragraph, explain what the new term means, what readers can now
distinguish, and link its canonical `docs/concepts.md#<anchor>` entry.

### Removed terms

#### Case: `<removed preferred term>`

##### Before

```md
<a concrete sentence using the removed preferred term>
```

##### After

```md
<the replacement sentence, or `Concept removed.`>
```

In one short paragraph, explain what the old term meant, why it disappeared,
and the documentation, API, CLI, or migration impact. Link the replacement
`docs/concepts.md#<anchor>` entry when one exists.

## Tests

<!--
Delete this entire section when no test, fixture, expected result, or harness
changes and no changed product behavior deliberately remains unautomated.

For every added or modified test file, paste review-complete final source once,
including owner, regression, rerun, and reliability comments. Complete final
source remains the default. When a long file would make the PR materially harder
to read, omit only unchanged code that is unrelated to this PR's claimed
behavior. Every omission must be replaced in the code block by one precise
marker:
`// … omitted: file=<path>; before=<unique exact final-source anchor>; after=<unique exact final-source anchor>; reason=<unrelated reason>`.
The two anchors must occur exactly once in the final file. The reviewer verifies
the locked base→head merge-base diff has zero changed lines strictly between
them. The retained fragments must be exact final source, not rewritten excerpts,
and must include every added or modified line, every affected test title, the
complete public actions that exercise the change, and every assertion that
protects it. Never omit owner/regression/rerun comments, setup, cleanup, helper
behavior, expected values, public actions, or assertions needed to understand why
the shown test is independent and distinguishing.

Introduce each source block with four lines. Purpose says whether it proves a
feature, prevents a bug regression, or both. Protects names the public behavior
that would escape if the test disappeared. Runs summarizes the public actions
actually executed. Asserts summarizes the independent expected outcomes checked
by the retained code. Do not describe a test as "changed", "rewritten", or a
list of receipt fields. Do not use the summary as a substitute for source.

List deleted tests separately with their replacement or the reason the owner no
longer exists. After the source files, keep one compact Verification receipt for
the shared candidate and run conditions. A lint or validation command is
verification, not a test file. A deliberately unautomated behavior records the
real public action, observation, and remaining risk instead of fake source.
-->

### `<added-or-modified-test-file>`

- Purpose: `feature | bug regression | feature + bug regression`
- Protects: <public behavior and the bug that would escape if this test were removed>
- Runs: <public commands, browser actions, or package entry points exercised>
- Asserts: <independent expected outcomes checked by this file>

```ts
<complete final file, or exact final-source fragments with file/unique-before/unique-after/reason omission markers>
```

### Deleted test files

<!-- Delete when no test file was removed. Repeat the block for each file. -->

#### `<deleted-test-file>`

- Previous owner: <public behavior>
- Replacement or reason: <new owner path, or why the behavior no longer exists>

### Verification receipt

- Candidate: <Git SHA and NiceEval tarball SHA-256>
- Red: <for a bug, old candidate or minimal mutation plus earliest failing stage; otherwise delete>
- Green: <exact public E2E command and result>
- Repeatability: <required takeover matrix and cleanup result, or why this live owner uses one authorized run>
- Fixed conditions: <checkout, lockfile, fixture, seed/clock policy, and image/provider identity>
- Unit count: <`pnpm test` Tests, or `not applicable — no Unit changed`>

### Deliberately not automated

<!-- Delete when every affected behavior has an automated owner. -->

- Case: <affected public behavior>
- Public action: <real production entry and runtime/version>
- Observation: <what the AI observed>
- Remaining risk: <what can still regress without an owner>
