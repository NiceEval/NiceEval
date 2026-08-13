<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker-in-Docker

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes. Name the user-visible capability or behavior, not
an internal mechanism such as its registry, protocol, or storage model. Keep one
dominant outcome and aim for 72 characters or fewer. Write the PR title and
description in the language of the user's latest request.

Keep every product-surface section below. Inside each surface, inventory
Removed, Added, and Changed as separate subsections; write "None" when a
direction has no entry. Do not put a change classification beneath an
individual command or symbol. Repeat the entry block as needed. Every entry
needs a concrete before example, after example, and user impact. Usage examples
must include the public owner that consumes the value; do not show an isolated
factory result when real usage belongs inside `defineEval()`,
`defineExperiment()`, report JSX, CLI invocation, or a package script.

The product-surface inventory does not replace Use cases. Surface entries show
what changed; Use cases show how a user completes a task across the affected
owners and where the workflow fails or stops being supported.

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

Complete the Record schema section for every PR, including when the answer is
"not affected". Public Record files, attachments, envelopes, discriminators,
field meanings, and public reader/writer behavior belong to the versioned
format. Private caches, indexes, temporary files, and directory organization do
not become public schema merely because they persist; inventory their data-loss
or observable impact separately. A version bump must identify the incompatible
public-format change and the stored-data upgrade path; a version that stays
unchanged must explain why the public format remains readable in both
directions. "No migration" is a valid decision only when the resulting reader
behavior and concrete user command for historical Records are stated.
-->

## Problem

- User goal: <what the user is trying to accomplish>
- Current limitation: <why the existing API or behavior cannot accomplish it safely or correctly>
- Required capability: <why the supporting API, protocol, or internal mechanism is necessary>
- User outcome: <what becomes possible after this PR>

## Use cases

<!--
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

#### `<package entry or symbol>`

- Before usage or result: <copyable TypeScript example and observed result>
- After usage or result: `removed`
- User impact: <what stops working and the concrete migration or replacement>

### Added

#### `<package entry or symbol>`

- Before usage or result: `not available`
- After usage or result: <copyable TypeScript example and observed result>
- User impact: <what becomes possible>

### Changed

#### `<package entry or symbol>`

- Before usage or result: <copyable TypeScript example and observed result>
- After usage or result: <copyable replacement example and observed result>
- User impact: <compatibility and migration effects>

## CLI commands

### Removed

#### `<command or flag>`

- Before usage or result: <copyable shell command and observed result>
- After usage or result: `removed`
- User impact: <what stops working and the concrete migration or replacement>

### Added

#### `<command or flag>`

- Before usage or result: `not available`
- After usage or result: <copyable shell command and observed result>
- User impact: <stdout, stderr, exit code, JSON schema, default, or workflow effect>

### Changed

#### `<command or flag>`

- Before usage or result: <copyable shell command and observed result>
- After usage or result: <the same command, or its replacement, and the observed result>
- User impact: <stdout, stderr, exit code, JSON schema, default, or migration change>

## Report components

### Removed

#### `<component, prop, or report entry>`

- Before usage or result: <copyable TSX example and rendered result>
- After usage or result: `removed`
- User impact: <author migration and reader-visible effect>

### Added

#### `<component, prop, or report entry>`

- Before usage or result: `not available`
- After usage or result: <copyable TSX example and rendered result>
- User impact: <authoring and reader-visible capability>

### Changed

#### `<component, prop, or report entry>`

- Before usage or result: <copyable TSX example and rendered result>
- After usage or result: <copyable replacement TSX and rendered result>
- User impact: <author migration and reader-visible effect>

## Observable behavior and data contracts

### Removed

#### `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: <concrete input and observed result>
- After usage or result: `removed`
- User impact: <effect on users, stored data, or automation and the replacement>

### Added

#### `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: `not available`
- After usage or result: <concrete input and observed result>
- User impact: <effect on users, stored data, or automation>

### Changed

#### `<runtime behavior, record/schema, cache, provider, or output>`

- Before usage or result: <concrete input and observed result>
- After usage or result: <the same input, or its replacement, and the observed result>
- User impact: <compatibility, migration, stored data, or automation effect>

## Record schema and stored-data upgrade

<!--
Always complete this receipt. If Record is unaffected, write "None" for the
affected surfaces and "not affected" for the remaining fields. Otherwise:

- Name every public persisted surface whose shape or meaning changes, including
  run/attempt metadata, events, artifacts, attachments, and envelopes. List
  private persisted implementation changes separately; they do not by
  themselves justify a public schema version bump.
- Explicitly check the stable `format` / `schemaVersion` / `producer`
  recognition header; public file names and file-presence rules; artifact and
  source-blob shapes; and every cross-file reference whose interpretation
  changes.
- Use `unchanged at <N>` or `<N> -> <M>` for the version decision.
- If the version is unchanged, explain why old readers remain correct on new
  data and new readers remain correct on old data.
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
- For a real migration, name the from/to versions, public trigger, preservation
  rules, atomicity, idempotence, interruption recovery, and data-loss boundary.
  Do not write only "migrated" or "handled".
-->

- Affected public Record Format surfaces: <`None` or exact files, attachments, fields, discriminators, and meanings>
- Private persisted implementation impact: <`None` or caches, indexes, temporary/layout changes and their observable or data-loss effect>
- Version decision: <`not affected` | `unchanged at N` | `N -> M`>
- Version reason: <why the change is compatible without a bump, or the exact incompatibility that requires one>
- Existing Record behavior: <what the new reader does with old data and what the old reader does with new data>
- Migration or recovery path: <`not applicable` with reason, or exact from/to versions, trigger/command, and user-visible result>
- Migration safety: <preservation, atomicity, idempotence, interruption recovery, and known data loss, or why no migration runs>
- Contract: <Record architecture link whenever Record is affected, or `not applicable`>
- Version history: <schema-version history entry when the version changes, otherwise `not applicable`>
- Verification: <literal old/new fixtures at the public Record owner, or real old/new Records exercised through the public writer, reader, or CLI; include exact commands and observed results>

## Environment variables

### Removed

#### `<VARIABLE_NAME>`

- Before usage or result: <copyable shell/config example and observed result>
- After usage or result: `removed`
- Environment boundary: <scope, producer, consumer, inheritance, default, precedence, validation, and secret exposure>
- User and security impact: <migration or "none">

### Added

#### `<VARIABLE_NAME>`

- Before usage or result: `not available`
- After usage or result: <copyable shell/config example, default, and observed result>
- Environment boundary: <scope, producer, consumer, inheritance, precedence, validation, and secret exposure>
- Necessity: <why an explicit API, CLI flag, config file, argument, or constant cannot own this value>
- User and security impact: <workflow, default, migration, or "none">

### Changed

#### `<VARIABLE_NAME>`

- Before usage or result: <copyable shell/config example, default, and observed result>
- After usage or result: <copyable shell/config example, default, and observed result>
- Environment boundary: <scope, producer, consumer, inheritance, precedence, validation, and secret exposure>
- Necessity: <why an explicit API, CLI flag, config file, argument, or constant cannot own this value>
- User and security impact: <compatibility, migration, or "none">

## Package scripts

### Removed

#### `<pnpm script>`

- Before usage or result: <copyable command and observed result>
- After usage or result: `removed`
- User impact: <development, CI, documentation, or release workflow migration>

### Added

#### `<pnpm script>`

- Before usage or result: `not available`
- After usage or result: <copyable command and observed result>
- User impact: <development, CI, documentation, or release workflow capability>

### Changed

#### `<pnpm script>`

- Before usage or result: <copyable command and observed result>
- After usage or result: <copyable command and observed result>
- User impact: <development, CI, documentation, or release workflow change>

## Tests

### `<test file, named owner, or manually verified behavior>`

- Change: `added | removed | renamed | substantially rewritten | not automated`
- Change class: `public-contract | internal-refactor | new-journey | bug-regression | test-retirement | not-automated`
- Disposition: `retain | delete | replace | not automated`
- Candidate identity: <Git SHA and NiceEval tarball SHA-256, or "not applicable">
- Contract and owner: `<docs path#anchor, or "no long-term automated owner">`
- Stability budget: <why this exact test file is inside the observable contract diff; list the replaced or deleted owner when applicable>
- Example scenario: <representative input, action, and expected result>
- Before: <the regression or contract violation that could escape>
- After: <what the test now proves>
- Distinguishing evidence: <historical fix parent, mutation, or contract-preserving perturbation reference and observed result>
- Verification: <exact commands and earliest failing prepare/invoke/observe/outcome/cleanup stage>
- Fixed conditions: <lockfile, fixture, seed, clock policy, and image digest or "not applicable">
- Repeatability: <isolated copies 1/2/3, same-copy runs 1/2, default parallel, file/title isolation, and resource cleanup results>
- Unit exception or no automation: <why E2E cannot distinguish this risk through a stable boundary, or the AI manual verification conditions and unprotected risk>
- Unit count: <`pnpm test` Tests; total must be 200 or fewer; Testkit has no independent Unit suite>
- Manual observation: <real runtime/version, production entry, AI actions, public result, and unprotected risk; "not applicable" for automation>
- User impact: <the user-visible behavior protected by this test>
