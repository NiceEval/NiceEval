<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker-in-Docker

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes. Name the user-visible capability or behavior, not
an internal mechanism such as its registry, protocol, or storage model. Keep one
dominant outcome and aim for 72 characters or fewer. Write the PR title and
description in the language of the user's latest request.

Keep every section below. Write "None" when the PR contains no entry for that
change direction. Organize the inventory by Removed, Added, and Changed; do not
organize it by product surface or put a change classification beneath each
command or symbol. Prefix every entry title with exactly one surface from
`Public API`, `CLI`, `Report`, `Observable behavior/data`, `Environment
variable`, or `Package script`, and repeat the entry block as needed. Every
entry needs a concrete before example, after example, and user impact. Usage
examples must include the public owner that consumes the value; do not show an
isolated factory result when real usage belongs inside `defineEval()`,
`defineExperiment()`, report JSX, CLI invocation, or a package script.

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
-->

## Problem

- User goal: <what the user is trying to accomplish>
- Current limitation: <why the existing API or behavior cannot accomplish it safely or correctly>
- Required capability: <why the supporting API, protocol, or internal mechanism is necessary>
- User outcome: <what becomes possible after this PR>

## Removed

### `<surface>: <entry>`

- Before usage or result: <copyable example and observed result>
- After usage or result: `removed`
- User impact: <what stops working and the concrete migration or replacement>
- Environment boundary: <for an environment variable only: scope, producer, consumer, inheritance, default, precedence, validation, secret exposure, and why an explicit channel cannot own it; otherwise omit>

## Added

### `<surface>: <entry>`

- Before usage or result: `not available`
- After usage or result: <copyable example and observed result>
- User impact: <what becomes possible, including stdout, stderr, exit code, JSON schema, rendered output, stored data, automation, or workflow effects where relevant>
- Environment boundary: <for an environment variable only: scope, producer, consumer, inheritance, default, precedence, validation, secret exposure, and why an explicit channel cannot own it; otherwise omit>

## Changed

### `<surface>: <entry>`

- Before usage or result: <copyable example and observed result>
- After usage or result: <the same input, or its replacement, and the observed result>
- User impact: <compatibility, migration, rendered output, stored data, automation, or workflow effects>
- Environment boundary: <for an environment variable only: scope, producer, consumer, inheritance, default, precedence, validation, secret exposure, and why an explicit channel cannot own it; otherwise omit>

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
- Repeatability: <fresh copies 1/2/3, same-copy runs 1/2, default parallel, file/title isolation, and resource cleanup results>
- Unit exception or no automation: <why E2E cannot distinguish this risk through a stable boundary, or the AI manual verification conditions and unprotected risk>
- Unit count: <`pnpm test` Tests; total must be 200 or fewer; Testkit has no independent Unit suite>
- Manual observation: <real runtime/version, production entry, AI actions, public result, and unprotected risk; "not applicable" for automation>
- User impact: <the user-visible behavior protected by this test>
