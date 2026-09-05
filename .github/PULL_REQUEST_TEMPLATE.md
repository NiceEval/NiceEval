<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker-in-Docker

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes. Name the user-visible capability or behavior, not
an internal mechanism such as its registry, protocol, or storage model. Keep one
dominant outcome and aim for 72 characters or fewer. Write the PR title and
description in the language of the user's latest request.

Use `pnpm pr:body --help` to create a compact Git-private managed draft. Set
Problem fields, product cases, and exact test sources through
`pnpm pr:body edit --help`; do not edit the managed Markdown file directly.
The editor orders populated template sections, removes empty headings, expands
test directives, enforces this template, and checks GitHub drift.

Keep only product-surface sections that contain a real change. Delete empty
directions and sections instead of writing "None". Under each included
direction, present every change as a named user case with concrete, fenced
Before and After inputs plus their literal observable outputs. Follow the
examples with a short User impact paragraph. Do not use `Name: summary` bullets
such as `Coverage:`, `Before usage or result:`, or `User impact:` in product
sections. The case and its examples are the explanation: do not replace them
with prose about a "contract", implementation mechanism, or change
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

Include the Terminology section only when the PR adds or removes terms from the
project's preferred vocabulary. Inventory a rename as one Removed term and one
Added term. Define each term in plain language and link its canonical entry in
`docs/concepts.md`. Delete unchanged directions and delete the whole section
when terminology is unchanged.
-->

## Problem

- User goal: <what the user is trying to accomplish>
- Current limitation: <why the existing API or behavior cannot accomplish it safely or correctly>
- Required capability: <why the supporting API, protocol, or internal mechanism is necessary>
- User outcome: <what becomes possible after this PR>

## Closing issues

<!--
Delete this section when merging the PR must not close an issue. Add one
`Fixes #<issue>` line per issue only through `pnpm pr:body edit closing-issue`;
GitHub will close each referenced issue when the PR merges into the default branch.
-->

Fixes #<issue>

## Use cases

<!--
Delete this entire section when the PR does not change a NiceEval product use
case. Do not turn implementation, documentation, CI, PR authoring, or review
mechanics into a user workflow merely to keep the section.

Describe complete user workflows, not API symbols. Inventory them under Added,
Changed, and Removed, omitting empty directions. Link every affected
`docs/**/use-case/**` leaf. Keep the canonical long example in the contract
document; the PR body must still show the smallest copyable public entry and
its observable result or diagnostic.

Across the repeated blocks, explicitly account for every applicable path:
- the minimum happy path;
- a multi-owner or multi-capability composition path;
- setup, reuse, teardown, or another lifecycle path when lifecycle changes;
- a named failure path;
- an explicitly unsupported boundary.

Omit paths that do not apply. Do not invent scenarios to satisfy a fixed count.
If one workflow covers the entire change, explain why it also covers the
relevant composition, lifecycle, failure, and unsupported boundaries.
-->

### Removed

#### Case: `<user goal>`

##### Starting state

```text
<the minimum concrete files, config, or previously completed public action>
```

##### Action

```<language>
<the smallest copyable usage beginning at a public owner>
```

##### Result

```text
<literal stdout, stderr, JSON, rendered UI text, or other observable result>
```

Explain in prose why this result completes the workflow. Link the complete
use-case document when one exists. Cover composition, lifecycle, failure, or
unsupported boundaries with additional real cases only when they apply; do not
list coverage classifications.

### Added

<!-- Repeat the complete readable Case block for every newly introduced leaf Use Case. -->

### Changed

<!-- Repeat the complete readable Case block for every existing leaf Use Case whose workflow or observable result changes. -->

## Public API

### Removed

#### Case: `<package entry or symbol>`

##### Before

```ts
<copyable TypeScript input>
```

```text
<observed result>
```

##### After

```text
removed
```

##### User impact

<what stops working and the concrete migration or replacement>

### Added

#### Case: `<package entry or symbol>`

##### Before

```ts
<the attempted TypeScript usage>
```

```text
<the compile or runtime failure proving it was unavailable>
```

##### After

```ts
<copyable TypeScript input>
```

```text
<observed result>
```

##### User impact

<what becomes possible>

### Changed

#### Case: `<package entry or symbol>`

##### Before

```ts
<copyable TypeScript input>
```

```text
<observed result>
```

##### After

```ts
<copyable replacement input>
```

```text
<observed result>
```

##### User impact

<compatibility and migration effects>

## CLI

### Removed

#### Case: `<command or flag>`

##### Before

```sh
<copyable command>
```

```text
<literal stdout, stderr, and exit status when material>
```

##### After

```text
removed
```

##### User impact

<what stops working and the concrete migration or replacement>

### Added

#### Case: `<command or flag>`

##### Before

```sh
<the attempted command>
```

```text
<literal rejection and exit status>
```

##### After

```sh
<copyable command>
```

```text
<literal stdout, stderr, JSON, and exit status when material>
```

##### User impact

<workflow and automation effect>

### Changed

#### Case: `<command or flag>`

##### Before

```sh
<copyable command>
```

```text
<literal stdout, stderr, JSON, and exit status when material>
```

##### After

```sh
<the same command or its replacement>
```

```text
<literal stdout, stderr, JSON, and exit status when material>
```

##### User impact

<workflow, automation, default, or migration effect>

## Report components

### Removed

#### Case: `<component, prop, or report entry>`

##### Before

```tsx
<copyable Report JSX>
```

```text
<rendered result>
```

##### After

```text
removed
```

##### User impact

<author migration and reader-visible effect>

### Added

#### Case: `<component, prop, or report entry>`

##### Before

```tsx
<the attempted Report JSX>
```

```text
<compile or runtime failure proving it was unavailable>
```

##### After

```tsx
<copyable Report JSX>
```

```text
<rendered result>
```

##### User impact

<authoring and reader-visible capability>

### Changed

#### Case: `<component, prop, or report entry>`

##### Before

```tsx
<copyable Report JSX>
```

```text
<rendered result>
```

##### After

```tsx
<copyable replacement Report JSX>
```

```text
<rendered result>
```

##### User impact

<author migration and reader-visible effect>

## Observable behavior and data contracts

### Removed

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

##### Before

```<language>
<concrete input>
```

```text
<observed output or state>
```

##### After

```text
removed
```

##### User impact

<effect on users, stored data, or automation and the replacement>

### Added

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

##### Before

```<language>
<attempted input>
```

```text
<observed absence or failure>
```

##### After

```<language>
<concrete input>
```

```text
<observed output or state>
```

##### User impact

<effect on users, stored data, or automation>

### Changed

#### Case: `<runtime behavior, record/schema, cache, provider, or output>`

##### Before

```<language>
<concrete input>
```

```text
<observed output or state>
```

##### After

```<language>
<the same input or its replacement>
```

```text
<observed output or state>
```

##### User impact

<compatibility, migration, stored data, or automation effect>

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

#### Action

```sh
<public writer or CLI command>
```

#### Result

```text
<literal recognition header plus changed files, attachments, fields, references, or meanings>
```

### Case: read an existing Record

#### Action

```sh
<public reader or CLI command, including the historical producer version when needed>
```

#### Result

```text
<direct read, migration, or exact rejection/recovery diagnostic>
```

### Case: upgrade or recover stored data

#### Version

`<N -> N | N -> M>`

#### Before

```sh
<copyable public read or recovery command>
```

```text
<what happens to existing data before this PR>
```

#### After

```sh
<copyable public read or recovery command>
```

```text
<what happens after this PR; include both reader directions when N -> N>
```

#### Safety

<preservation, atomicity, idempotence, interruption recovery, and known data loss; or why no migration runs>

#### User impact

<required action and observable result>

#### Evidence

<Record architecture; version history when N -> M; exact public verification command and result>

### Private persisted data

<!-- Delete when private persistence is unaffected. -->

### Case: <cache, index, temporary file, or layout scenario>

#### Before

```text
<observable behavior or data-loss boundary>
```

#### After

```text
<observable behavior or data-loss boundary>
```

#### User impact

<required action, recovery, or no action with concrete reason>

## Environment variables

### Removed

#### Case: `<VARIABLE_NAME>`

##### Before

```sh
<copyable environment and command input>
```

```text
<observed result>
```

##### After

```text
removed
```

##### Environment boundary

<scope, producer, consumer, inheritance, default, precedence, validation, and secret exposure>

##### User and security impact

<concrete migration and security impact; omit the case if there is no change>

### Added

#### Case: `<VARIABLE_NAME>`

##### Before

```sh
<attempted environment and command input>
```

```text
<observed absence or rejection>
```

##### After

```sh
<copyable environment and command input>
```

```text
<default and observed result>
```

##### Environment boundary

<scope, producer, consumer, inheritance, precedence, validation, and secret exposure>

##### Necessity

<why an explicit API, CLI flag, config file, argument, or constant cannot own this value>

##### User and security impact

<concrete workflow, default, migration, and security impact>

### Changed

#### Case: `<VARIABLE_NAME>`

##### Before

```sh
<copyable environment and command input>
```

```text
<default and observed result>
```

##### After

```sh
<copyable environment and command input>
```

```text
<default and observed result>
```

##### Environment boundary

<scope, producer, consumer, inheritance, precedence, validation, and secret exposure>

##### Necessity

<why an explicit API, CLI flag, config file, argument, or constant cannot own this value>

##### User and security impact

<concrete compatibility, migration, and security impact>

## Package scripts

### Removed

#### Case: `<pnpm script>`

##### Before

```sh
<copyable command>
```

```text
<observed result>
```

##### After

```text
removed
```

##### User impact

<development, CI, documentation, or release workflow migration>

### Added

#### Case: `<pnpm script>`

##### Before

```sh
<attempted command>
```

```text
<observed rejection>
```

##### After

```sh
<copyable command>
```

```text
<observed result>
```

##### User impact

<development, CI, documentation, or release workflow capability>

### Changed

#### Case: `<pnpm script>`

##### Before

```sh
<copyable command>
```

```text
<observed result>
```

##### After

```sh
<copyable command>
```

```text
<observed result>
```

##### User impact

<development, CI, documentation, or release workflow change>

## Terminology

<!--
Delete this entire section when terminology is unchanged, and delete either
direction when it has no cases. A term is a preferred domain word recorded in
docs/concepts.md, not every new identifier in source. For a rename, list the
old term under Removed and the replacement under Added.
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
The managed editor also accepts `<BOF>` for a retained fragment's start and
`<EOF>` for its end, so callers can include file boundaries without adding
artificial anchor comments to tests. Omission markers still use real source lines.
The two omission anchors must occur exactly once in the final file. The reviewer verifies
the locked base→head merge-base diff has zero changed lines strictly between
them. The retained fragments must be exact final source, not rewritten excerpts,
and must include every added or modified line, every affected test title, the
complete public actions that exercise the change, and every assertion that
protects it. Never omit owner/regression/rerun comments, setup, cleanup, helper
behavior, expected values, public actions, or assertions needed to understand why
the shown test is independent and distinguishing.

`source=link` is an explicit alternative to that one inline source block; it is
not selected automatically. It replaces repeated code with two immutable links:
complete final source in the target PR's head repository at commit `H`, and that
target base's actual merge-base `B` to `H` diff. The editor rejects publishing
when any rendered test, sidecar, owner authority, canonical contract, or template
input is missing or differs from `H`; a local preview may identify uncommitted
input but must never present it as accepted by the linked `H`.
Before a PR exists, local render and check instead show an explicit pending
publication notice with no GitHub link; this permits drafting before push without
claiming a repository, commit, or diff that GitHub has not accepted.

Before each source block, describe every canonical `path#caseId` in short,
complete sentences. State the user behavior proved, link the final Feature or
leaf Use Case, name the real public entry, identify the key assertion, and say
what error deleting the case would release. Mention a current Problem regression
naturally when one exists; otherwise omit it. Do not expose the internal testing
Owner, and do not format this as Owner:/Covers:/Purpose:/Protects:/Regression:/
Runs:/Asserts: fields. The checker resolves selector -> current owner -> canonical
contract and verifies that relation against the rendered link. Multi-case files
receive one narrative per case and show the required final source only once.

List deleted tests separately with their replacement or the reason the owner no
longer exists. After the source files, keep one compact Verification receipt for
the shared candidate and run conditions. A lint or validation command is
verification, not a test file. A deliberately unautomated behavior records the
real public action, observation, and remaining risk instead of fake source.
-->

### `<added-or-modified-test-file>`

#### `<path#caseId>`

In short complete sentences, explain the proved user behavior, link its final
Feature or leaf Use Case, name the public entry, identify the key assertion, and
state the error that could escape if this case were deleted. When applicable,
link its current Problem regression in one additional sentence.

```ts
<complete final file, exact final-source fragments with file/unique-before/unique-after/reason omission markers, or explicit source=link immutable source and B→H diff links>
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
