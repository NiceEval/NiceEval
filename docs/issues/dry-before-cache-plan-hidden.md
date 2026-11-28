# exp --dry does not show the Before cache plan or expected snapshots

## Observation

`niceeval exp ... --dry --json` (NiceEval main @ 9022dda86, used by NiceEval-Eval through a local link) reports per-slot reuse decisions (`matrix[].slots[].state`, `comparisons`) but nothing about the Before cache plan. For an Instabox Experiment with a nine-action before chain plus eval-level actions, the dry document gives no way to tell which before nodes would `hit`, which would be prepared, where the publication points are, or how many remote snapshots a real run would publish.

Reproduction (NiceEval-Eval): `pnpm --silent exec niceeval exp harness/canary <six evals> --no-pause --dry --json` → keys `format, schemaVersion, total, evals, configs, attempts, reused, matrix, groups, plugins`; no field mentions before cache, nodes, artifacts or snapshots.

After a real run, the only public trace is `cache-degraded` diagnostics on each Attempt (`show @<locator> execution --json`), e.g. Run `01f7199a-ab85-45ab-bb53-21d363d8b59f`, where the first publication point `codex-cli-0.171.0` settled `snapshot-uncertain` and every descendant `parent-unavailable`. Successful `hit` / `prepared` settlements leave no comparable summary.

## Expected

Before a paid remote run, the dry plan shows the Before cache preparation graph per Experiment × Eval pairing: each node's action, expected settlement (`hit` from an existing artifact, or `prepare`), which nodes are publication points (terminal, fork, changeFrequency boundary), and the resulting count of new snapshots / staging instances. After a run, the Run (or Invocation) exposes the same graph with actual settlements.

## Impact

Users of remote Providers (Instabox, E2B, OpenSandbox) pay per instance time and snapshot. They cannot predict preparation cost or confirm that caching works without reading Attempt diagnostics one by one; a run where every snapshot silently failed looked like a normal pass.

## Provenance

Found 2026-11-28 while answering "will a run publish one snapshot per layer?" for NiceEval-Eval; the answer required reading `docs/feature/sandbox/architecture/before-cache.md#发布点` and inferring from diagnostics.
