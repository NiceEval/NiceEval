<!--
Title: <type>(<scope>): <imperative outcome>
Example: feat(sandbox): add managed rootless Docker profiles

Types: feat, fix, docs, refactor, test, ci, chore.
Choose the type from the PR's final outcome, not its first commit. Update the
title when the scope changes, keep one dominant outcome, and aim for 72
characters or fewer. Delete this comment only if it distracts from editing;
GitHub does not include comments in the rendered PR body.
-->

## Why

<!-- What user or engineering problem does this solve, and why now? -->

## What changed

<!-- Describe outcomes and the important implementation path, not a file list. -->

-

## Public contract

<!--
Use additive, breaking, behavior-change, internal-only, or uncertain. NiceEval
is beta, so a breaking change is allowed when it is intentional and consistently
reflected in implementation, documentation, tests, and migration guidance.
-->

- Compatibility:
- Public API:
- CLI:
- Observable behavior or persisted data:
- Migration required: none

## Validation

<!-- Report reproducible evidence from the current PR HEAD. Do not count fixes
that exist only in another checkout or downstream repository as PR evidence. -->

| Check | Environment | Result |
| --- | --- | --- |
| `pnpm ...` | local / CI / downstream | pass / fail / blocked |

## Known gaps and merge blockers

<!-- Include unresolved review findings, failing CI, external blockers, and work
deferred to a follow-up PR. Write "None" only when there are no known gaps. -->

-

## Documentation and release impact

- Feature contract:
- `docs-site`:
- Examples:
- Release notes or migration:
