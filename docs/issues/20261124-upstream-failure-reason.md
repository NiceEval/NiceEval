# Expose upstream failure reasons for live Turns and uncertain remote snapshots

## Observation

During two consecutive e2e runs on main (GitHub Actions runs 45330820363 and 45340592045, NiceEval 9ff0ca541), several live-adapter and remote-snapshot failures could not be attributed from public outputs:

- DeepSeek Harness: the real Turn ended with verdict `failed` (not `errored`); the public receipt and `show` output do not say which native terminal reason (aborted, blocked, error, max-tokens) the adapter decoded.
- Claude Code / OpenCode Go: Attempts errored or hit the inner deadline; the per-Attempt upstream HTTP status or gateway error is not visible through `show`, and CI stdout truncation removed the rest.
- Instabox before cache: a snapshot settled as `snapshot-uncertain` with "Snapshot request outcome is uncertain; its ledger entry is retained"; the public trace does not carry the driver's POST/GET status chain (accepted, Ready poll failure, mismatch, budget expiry).

Only the Claude Agent SDK path printed the upstream `API Error: 503` in a form that identified the cause.

## Expected

When a Turn fails or a remote snapshot settles as uncertain, the public CLI slices (`show <locator> execution --json` or the relevant trace) expose the decoded upstream reason or provider status that led to that verdict, so an operator can tell an external outage from a NiceEval regression without reading internal storage.

## Impact

Two e2e triage passes had to classify four live-adapter failures and one Instabox failure as "most likely external" without proof, which slows release decisions and could hide a real regression.

## Provenance

Found while triaging e2e failures after the TLA+-driven fixes on main (2026-11-24). Analysis reports are private; this draft contains only public CI run IDs.
