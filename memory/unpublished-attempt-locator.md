---
format: niceeval.memory/v1
id: unpublished-attempt-locator
title: Failed Attempt persistence exposed an unqueryable locator
createdAt: 2026-08-30
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_W2VKAM0W4M5JQHNX
      - netake_GJJA4SEJARRRNT6W
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/runner/test/timing.test.ts#necase_EP0HS2HD783EN64J"]}
promotions: []
---
## Observation

When final Attempt persistence fails after reservation, `niceeval exp --json` prints the reserved `@...` locator even though no published Attempt is available through `niceeval query run` or `niceeval show`.

Formal public-entry red evidence: `nered_282DW0QTHQTZ3CS8` for `e2e/runner/test/timing.test.ts#necase_EP0HS2HD783EN64J`.

## Root cause

The Runner copied the reservation locator into `EvalResult` before `completeAttemptOrMarkIncomplete` succeeded. The Record coordinator intentionally converted the completion write error into an incomplete result and retained it for invocation publication failure, but the feedback path still treated the provisional locator as public and emitted a permanent failure event.

## Required behavior

Only a successfully persisted Attempt may contribute a public locator. A completion write failure must keep the invocation failed, omit an inspectable locator, and render an explicit persistence/publication diagnostic instead of `[object Object]`.
