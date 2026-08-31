---
format: niceeval.memory/v1
id: attempt-publication-diagnostic-context
title: Attempt publication failure lost cause and locator
createdAt: 2026-08-31
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_1YRM35STW950K9J2
      - netake_JNVDV30J4MSW7PS8
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/runner/test/attempt-publication-failure.test.ts#necase_MJKBRQFQP8P4EWH5"]}
promotions: []
---
## Observation

When a completed Attempt could not cross its publication fence, `niceeval exp --json` failed with a generic persistence message. The diagnostic omitted both the underlying storage failure and the reserved Attempt locator, so the user could not identify the affected Attempt or distinguish an unpublished aggregate from an inspectable result.

## Root cause

The Runner coordinator replaced every non-Assertion completion failure with one constant `runner-record-attempt-publication-failed` object. That replacement discarded the original typed failure and the locator already reserved for the Attempt.

## Required behavior

An Attempt publication failure names the affected reserved locator and preserves the underlying typed failure code in its public diagnostic. The locator remains diagnostic context only: Inspection and reuse must continue to reject the unpublished Attempt.

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `980711e7d3d99b4441fa276aab8067d724950c87`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_28383A34332WSX13",
    "netake_VDNVQ457ZW5AB04D",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/runner/test/timing.test.ts#necase_MJKBRQFQP8P4EWH5\"]}"
  ]
}
```
