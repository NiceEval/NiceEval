# Case ownership

Use `pnpm run repo docs test inventory --help` first, then `list [pattern]` to find candidates and `show <repo-relative-path#caseId>` to confirm one exact case.

Each runner-collected E2E case has a permanent `necase_...` token at the end of its visible title and one current owner in managed comments immediately above its real declaration. Select it as `<repo-relative-path>#<caseId>`: ID is identity and path is a stale guard. One owner contract may serve multiple cases, but links to exactly one Feature or leaf Use Case. Use named commands for relation and history changes. AST locates declaration comments; executable inventory comes only from native runner collection. Helper declarations use `@concord-test-file` to preserve the native owner path.

Follow each command's current help:

```sh
pnpm run repo docs test inventory --help
pnpm run repo docs test owner create --help
pnpm run repo docs test case attach --help
pnpm run repo docs test regression add --help
pnpm run repo docs test issue add --help
pnpm run repo docs test case move --help
pnpm run repo docs test regression refresh --help
```

The normal order is inventory → owner create or reuse → case attach → zero or more regression/Issue additions → `show <path#caseId>`. Repeat relation commands for each case in a multi-case file; never copy a file-level relation to every case.

Add regression only for a Problem Memory with formal red and green receipts. Add Issue only after read-only verification of the canonical repository, non-PR identity, and direct provenance. Diagnose receipts do not satisfy formal gates. Use `retire`, not physical deletion, for owner, case, regression, and Issue lifecycle changes. One-time repository migrations require explicit authorization and exact mappings; there is no product migration command. History and tombstones remain in `e2e/concord-history.ts`. Refresh legacy or stale proof with `regression refresh --reason`, fresh managed v2 red/takeover IDs and native inventory; preserve old receipts and the current regression.
