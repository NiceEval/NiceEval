# agent.install shows a stale 'repair failed' line and no transfer progress for minutes

## Observation

While the built-in Codex Sandbox Agent installs its locked CLI into an Instabox Sandbox, `niceeval invocation show <id>` stays on one line for about ten minutes:

```
agent.install since 06:41:05Z
  installing official OpenAI Codex CLI 0.167.2; probe miss: codex version mismatch: expected 0.167.2, actual 0.160.0.; repair failed: sandbox command exited with code 1: codex --version; stderr tail: codex version mismatch: expected 0.167.2, actual 0.160.0.
```

During that time the installer downloads the Codex package on the host and uploads it (about 320 MB native binary) into each Sandbox, then extracts it. None of this shows up in the progress line, and the text says "repair failed". The install finished at 06:51 and the Attempt continued normally.

## Impact

Two independent coding agents running NiceEval-Eval read the line as a stalled install, saw no installer process inside the Sandbox, and interrupted their runs after five minutes. That cost three paid validation runs and left interrupted Runs behind. A user cannot tell from the public CLI whether the install is progressing, how far the transfer is, or that "repair failed" is an intermediate probe result rather than the final outcome.

## Expected

`invocation show` reports the current install step (download, upload with bytes transferred, extract, verify) and does not present the probe miss as a failure while the install is still running.

## Reproduction

1. A Sandbox whose preinstalled `codex` is older than the locked version (Instabox `universal` template ships 0.160.0).
2. `niceeval exp <experiment using codexAgent on Instabox> <eval>`.
3. `niceeval invocation show <id>` during `agent.install`.

## Identity and environment

- Host NiceEval: workspace build `0.0.0-development` built 2026-11-15 05:31 UTC; candidate inside the Sandbox is npm `niceeval@0.21.0`.
- Instabox template `universal` version `2026-11-01.3-android.1-cli.1`.
- Invocation `s_2da0b3a9-e437-4040-b8c9-d9b8c99b12a3` (NiceEval-Eval), 2026-11-15.

## Provenance

Observed in NiceEval-Eval while validating new held-out evals; confirmed read-only inside the Sandbox with `instabox exec` (payload at `~/.niceeval-agent-payload/codex.tgz`, extraction under `~/.local/lib/codex`).
