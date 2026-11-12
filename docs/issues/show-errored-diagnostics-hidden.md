# Errored Attempt overview hides recorded failure diagnostics

## Observation
Installed candidate 45e7381bc on Linux / Node / pnpm: an errored Attempt's default `niceeval show @<locator>` omits the saved failure phase and error summary. Users cannot diagnose a failed execution from its overview.

## Reproduction
In the deterministic Inspection consumer, run `niceeval exp usage-unsealed --rerun all --json`, then `niceeval show @<returned locator>`. `query run` with `attempt.trace` can read the saved JOURNAL_NOT_SEALED diagnostic, but the default Show cannot.

## Expected
Show the recorded failure phase and summary directly, include Diagnostics in Sections, and link to the existing execution slice. Missing recorded diagnostics must be explicitly unavailable with a reason.

## Provenance
Sanitized local dogfood report, reproduced through the public CLI. No secrets or private material. Suggested labels: bug, area:cli, needs-triage. Open and closed Issues searched; no matching observation found.
