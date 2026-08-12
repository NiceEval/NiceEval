---
title: 'show rejects documented --execution evidence view'
severity: 'major'
---

## Expected Behavior

The public CLI contract and agent feedback guidance promise that `niceeval show ... --execution` opens an Attempt execution-evidence view, including Assertion diagnostics.

## Current Behavior

After a successful assertion-scopes experiment, `niceeval show @<locator> --record .niceeval --execution` exits 1 with `niceeval show does not accept --execution.` The parser still knows the flag, but the Report-oriented show command rejects it. This blocks the owner from verifying retained ToolMatch diagnostics through the public inspection path.

## Possible Solution

Give `show --execution` a Report route or adapter that exposes the documented execution evidence, or reconcile the public CLI/agent guidance with the supported Report-only selection model.

## Minimal Reproducible Example

1. Run `pnpm e2e --repo eval -- --run test/assertion-scopes.test.ts`.
2. Use the emitted locator with `niceeval show @<locator> --record .niceeval --execution`.
3. Observe the unsupported-flag error.

## Context

Observed during the Assert-first ToolMatch runtime migration. The first E2E failure was the retired NDJSON `result` event; its owner was updated to the current `eval` conclusion event. The retained second failure is the product gap above. Durable E2E evidence: `/tmp/niceeval-e2e-artifacts-wgbCi4`.
