# Unsupported user database degrades every Before cache silently and loses orphan tracking

## Observation

On 2026-11-25 NiceEval-Eval ran `niceeval exp --experiment install/canary --experiment harness/canary` (runner: NiceEval main 30bb8c559 via link; 29 Attempts on Instabox). The user database `~/.niceeval/niceeval.sqlite` had been written by an older NiceEval on 2026-11-14.

- The Invocation started normally. No start-time warning or error mentioned the user database.
- Every Attempt then recorded, per before action, `Before cache degraded: ledger-unavailable; Unsupported user database format (user-database-unsupported). Stop consumers, reconcile retained provider artifacts and holds, then remove the user database and rerun`, followed by a cascade of `parent-unavailable` entries. `show @<locator>` lists more than ten `cache degraded` reasons per Attempt; `show @<locator> assertions` is where the real verdict reason lives.
- The JSON event stream showed no `cache-degraded` warning event; the run looked healthy from progress events alone.
- An earlier Invocation in the same session was interrupted. Its ten Instabox instances stayed `running` after the next Invocation completed; `coordination-recovered` notices were emitted but the Provider instances were not reclaimed. They had to be deleted by hand with `instabox rm`.
- The guidance says to "reconcile retained provider artifacts and holds" first, but there is no public command to do that against a database the current version refuses to read. Instabox still lists 128 `niceeval-*` snapshots that only the old database knew about.

## Expected

- An unsupported user database is reported once, at Invocation start (and in `--dry`), as one diagnostic with the repair path, instead of per-action degradation inside every Attempt.
- Provider instances created by an interrupted Invocation are either reclaimed on the next run or reported with a public command to reclaim them.
- The repair guidance names a public command that can enumerate and reconcile artifacts recorded in the old database, or states which NiceEval version can do it.

## Follow-up

The first expectation is resolved by the [Invocation preflight](../feature/sandbox/data-model.md#user-database-preflight).
Provider instance recovery and reconciliation of artifacts recorded in the old database remain open.

## Impact

A full paid run silently lost all Before cache reuse; orphaned running instances kept billing; the operator cannot follow the repair instruction without reading internals.

## Provenance

NiceEval-Eval dogfooding, 2026-11-25. Public evidence: `show @1KPZAG5D41445` (diagnostics `diagnostic_00000crbgh0v9857j7ncm9s94w`), `instabox ls` / `instabox snapshot ls`.
