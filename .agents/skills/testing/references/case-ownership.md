# Case ownership

Use `pnpm run repo docs test inventory --help` first, then `list [pattern]` to find candidates and `show <repo-relative-path#caseId>` to confirm one exact case.

Each runner-collected E2E case has a permanent `necase_...` token at the end of its visible title and one current owner in the adjacent managed sidecar. Select it as `<repo-relative-path>#<caseId>`: ID is identity and path is a stale guard. One owner contract may serve multiple cases, but links to exactly one Feature or leaf Use Case. Never hand-edit sidecars, tokens, or relations, and do not discover tests through AST or source scanning.

Follow each command's current help:

```sh
pnpm run repo docs test inventory --help
pnpm run repo docs test owner create --help
pnpm run repo docs test case attach --help
pnpm run repo docs test regression add --help
pnpm run repo docs test issue add --help
pnpm run repo docs test case move --help
pnpm run repo docs test migrate plan --help
pnpm run repo docs test migrate apply --help
```

The normal order is inventory → owner create or reuse → case attach → zero or more regression/Issue additions → `show <path#caseId>`. Repeat relation commands for each case in a multi-case file; never copy a file-level relation to every case.

Add regression only for a Problem Memory with formal red and green receipts. Add Issue only after read-only verification of the canonical repository, non-PR identity, and direct provenance. Diagnose receipts do not satisfy formal gates. Use `retire`, not physical deletion, for owner, case, regression, and Issue lifecycle changes. Migrate legacy headers with `migrate plan` followed by `migrate apply`; multi-case mappings must be explicit.
