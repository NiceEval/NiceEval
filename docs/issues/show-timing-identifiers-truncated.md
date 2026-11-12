---
relations:
  - role: root-cause
    target: memory/cli-diagnostic-projections-lose-saved-evidence.md
---

# Timing output truncates activity names and failure locations

## Observation
Installed candidate 45e7381bc on Linux / Node / pnpm: piped `niceeval show @<locator> --timing` truncates activity IDs, phases and labels with ellipses. Failed work cannot be identified.

## Reproduction
In the deterministic Inspection consumer, run `niceeval exp usage-unsealed --rerun all --json`, then pipe `niceeval show @<returned locator> --timing`. Activity cells lose identifying text.

## Expected
Non-TTY timing preserves activity names and phases. Narrow terminals give names priority over opaque IDs. Failed activities are listed clearly with their full name and phase.

## Provenance
Sanitized local dogfood report through public CLI; no secrets or private material. Suggested labels: bug, area:cli, needs-triage. Open and closed Issues searched; no duplicate found.
