# Local E2E execution

Treat local E2E as a small number of formal checkpoints, not an interactive debug loop. A formal E2E invocation is an exclusive heavy resource in the shared workspace. Before starting, confirm that this task has no running or uncollected E2E process tree, and use only the parent agent or the one execution worker assigned as E2E owner. Other workers may perform independent implementation or read-only investigation that does not start formal E2E. Never multiply candidate packing, installation, Testkit preparation, or formal runs across workers; CI owns the complete matrix.

Select the narrowest formal checkpoint that proves the affected owner: normally one `--repo`, then one native file or title when supported. Do not use an unscoped local lane or full-matrix run when a named Repo or case suffices. When several Repos must validate the same candidate, pack the candidate once, then run the Repos serially from that artifact; prepare each Repo only once for that candidate. Candidate byte changes invalidate retained scenes and require new formal preparation.

Use full local E2E only for the first public red, the fixed candidate's targeted green, and required takeover or final receipts. If the first red needs localization, retain it with `--keep-workdir`, then use short diagnostics instead of repeating pack, install, or the Repo timeout:

```sh
pnpm e2e diagnose test --from <summary.json> --repo <id> [--timeout-seconds 15] -- <native target args>
pnpm e2e diagnose exec --from <summary.json> --repo <id> [--timeout-seconds 15] -- <argv>
```

Diagnostics reuse the installed candidate, Testkit, environment filtering, and cleanup, but each attempt receives a new diagnostic receipt. A diagnostic green is not a formal pass. Do not leave temporary `only`, shortened timeouts, logs, or diagnostic assertions in an owner.

Generate the old-candidate red receipt with `pnpm e2e evidence red --help`; generate the green and deterministic reliability certificate with `pnpm e2e takeover --help`. New or substantially changed deterministic owners must pass isolated repetitions, same-copy repetition, default parallel execution, single-case execution, and resource cleanup. Finish with `pnpm run repo docs test show <path#caseId>`, the narrow E2E command, `pnpm test` when required, `pnpm typecheck`, and `pnpm lint`, preserving the receipts required by the PR template.

Keep independently owned cases concurrent once their project copy, result root, ports, processes, containers, and external-state identities are separate. Express this with `test.concurrent` or `test.concurrent.each`; do not rely on file splitting or implicit global mode. Do not add a Repo- or domain-wide concurrency cap to make a shared runner pass. Only the smallest region intentionally sharing mutable evidence or resources may remain serial, and that ownership must be evident in the test.

Treat host OOM, process explosion, and resource contention as infrastructure failures, not permission to weaken an owner. Preserve contracted fixture size, timeout budget, and owner-internal concurrency. Smaller fixtures, longer timeouts, lower concurrency, skipped owners, or lane removal are diagnostic experiments only unless the corresponding Feature or Roadmap contract is explicitly revised.

For performance failures, distinguish active computation from a terminal failure whose Scope, worker, child process, database, container, or Sandbox was not reclaimed. Profile the installed candidate's public entry, then fix computation, scanning, serialization, persistence, typed-failure, or lifecycle causes as indicated. Classify unrelated Docker timing and historical flaky failures separately from the affected owner.
