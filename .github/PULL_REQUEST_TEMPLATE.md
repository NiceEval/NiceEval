<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker-in-Docker

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes. Name the user-visible capability or behavior, not
an internal mechanism such as its registry, protocol, or storage model. Keep one
dominant outcome and aim for 72 characters or fewer. PR titles and descriptions
must be written in English.

Keep every section below. Write "None" when that surface does not change.
Repeat the entry block when a section contains multiple changes. Every changed
entry needs a concrete before example, after example, and user impact. Usage
examples must include the public owner that consumes the value; do not show an
isolated factory result when real usage belongs inside `defineEval()`,
`defineExperiment()`, report JSX, CLI invocation, or a package script.
-->

## Public API

### `<package entry or symbol>`

- Classification: `additive | breaking | behavior-change | internal-only | uncertain`
- Before usage: `<copyable TypeScript example or "not available">`
- After usage: `<copyable TypeScript example or "removed">`
- User impact: <what users can do now or how they must migrate>

## CLI commands

### `<command or flag>`

- Classification: `additive | breaking | behavior-change | internal-only | uncertain`
- Before usage: `<copyable shell command or "not available">`
- After usage: `<copyable shell command or "removed">`
- User impact: <stdout, stderr, exit code, JSON schema, default, or migration change>

## Report components

### `<component, prop, or report entry>`

- Classification: `additive | breaking | behavior-change | internal-only | uncertain`
- Before usage: `<copyable TSX example or "not available">`
- After usage: `<copyable TSX example or "removed">`
- User impact: <rendered result, authoring workflow, or migration change>

## Observable behavior and data contracts

### `<runtime behavior, record/schema, cache, provider, or output>`

- Classification: `additive | breaking | behavior-change | internal-only | uncertain`
- Before example: <concrete input and observed result>
- After example: <the same input, or its replacement, and observed result>
- User impact: <what changes for users, stored data, or automation>

## Package scripts

### `<pnpm script>`

- Change: `added | removed | renamed | command changed`
- Before usage: `<copyable command or "not available">`
- After usage: `<copyable command or "removed">`
- User impact: <development, CI, documentation, or release workflow change>

## Tests

### `<test file or named case>`

- Change: `added | removed | renamed | substantially rewritten`
- Example scenario: <representative input, action, and expected result>
- Before: <the regression or contract violation that could escape>
- After: <what the test now proves>
- User impact: <the user-visible behavior protected by this test>
