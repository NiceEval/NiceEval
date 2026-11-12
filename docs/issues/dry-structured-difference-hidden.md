---
relations:
  - role: root-cause
    target: memory/cli-diagnostic-projections-lose-saved-evidence.md
---

# Dry preview collapses structured differences into identical placeholders

## Observation
Installed candidate 45e7381bc on Linux / Node / pnpm: `niceeval exp <experiment> --dry` prints `structured value (summary incomplete) → structured value (summary incomplete)` for changed structured configuration. The two sides are indistinguishable. Bundled Chinese docs do not explain locked or source-member-missing.

## Reproduction
Run a deterministic Experiment whose flags include a string longer than 512 characters. Change one flag and run `niceeval exp <experiment> --dry`.

## Expected
Distinguish available summaries using short display digests, or explain once why the saved summaries cannot distinguish the values. Document all dry status words and gap codes, user action and next commands. Do not change execution identity or persisted manifests.

## Provenance
Sanitized local dogfood report through public CLI. No secrets or private material. Suggested labels: bug, area:cli, needs-triage. Open and closed Issues searched; #300 concerns accepted current identity rather than this presentation defect.
