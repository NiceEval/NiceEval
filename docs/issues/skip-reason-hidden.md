# Skipped Attempt hides the t.skip reason behind unrelated advisories

## Observation

NiceEval-Eval `install/comfyui` calls `t.skip("ComfyUI 安装题尚未设计")`. In the 2026-11-25 run (NiceEval main 30bb8c559) its Attempt `@1KPZAG5D41445`:

- `show @1KPZAG5D41445` reports `Outcome cancelled`, `Verdict skipped`, and its Advisories list only `Reason cache degraded` entries from `sandbox.prepare`. The skip message does not appear.
- `show @1KPZAG5D41445 assertions` says `No Assertion entries recorded`.
- `show @1KPZAG5D41445 execution --json` contains no field with the skip message.

The cause of the skip could only be found by reading the Eval source.

## Expected

A skipped Attempt shows the reason passed to `t.skip` as its primary reason in `show` (human and `--json`), separate from preparation advisories; `Outcome` distinguishes an Eval-requested skip from a cancellation.

## Impact

Operators cannot tell an intentional skip from an environment cancellation without reading Eval source, which downstream rules forbid for diagnosis.

## Provenance

NiceEval-Eval dogfooding, 2026-11-25, public `show` output.
