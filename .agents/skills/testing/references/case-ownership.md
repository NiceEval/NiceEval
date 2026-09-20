# Case ownership

Write exactly one `// @feature docs/feature/<name>/README.md` or `// @use-case docs/feature/<name>/use-case/<name>.md` above each static test declaration. Keep natural test titles. Several tests may share one contract. Helpers use `@test-file` for a different native entry path.

Run `pnpm run repo docs test inventory --help`, then fresh native inventory for the Repo. Use the returned derived `<path#caseId>` selector for list/show, regression and Issue commands. The reference is derived from native path, declaration path and title; changing any of these changes it. AST locates metadata; native collection uniquely binds executable cases to actual execution-copy declarations.

Use each command’s current help. The workflow is declaration annotation → inventory → show/audit → optional regression/Issue operations. Add regression only with formal red and green receipts. Add Issue only after canonical repository, non-PR identity and direct provenance verification. Diagnose receipts do not satisfy formal gates.

Retire case and relations through named lifecycle commands. History and tombstones remain in `e2e/concord-history.ts`; migration preserves them without rewriting old evidence. Refresh stale proof with `regression refresh --reason`, fresh managed red/takeover IDs and native inventory.
