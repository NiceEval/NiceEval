---
format: niceeval.memory/v1
id: adapter-usage-overview-drops-token-facts
title: Adapter usage facts disappear from Insight token metrics
createdAt: 2026-09-21
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_1HVH3DKD59RGW6X8
      - netake_90P9D616N550QMCA
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/eval/test/external-usage.test.ts#necase_920FSWMBVEP3090H"]}
promotions: []
---
## Problem

A custom Adapter can persist physical-call token facts through `ctx.recordUsage`, and `attempt.usage` can read those facts, while `overview.get` and Insight still report token usage as unavailable. The Overview selector passed only Agent turn attachments into the usage projection and therefore ignored the Adapter usage attachment.

A second trap exists when an Adapter reports input buckets. `inputTotalTokens` is the authoritative input total when present. When it is absent, the known subtotal must include the mutually exclusive `inputTokens`, `cacheReadTokens`, and `cacheWriteTokens` buckets. Summing only `inputTokens` undercounts cache usage; adding buckets when `inputTotalTokens` is present double-counts it.

## Root cause

`attemptOperationalMetrics` did not pass the Adapter usage attachment into `projectAttemptUsage`. Its token aggregation was built around Agent turn totals and had no per-call projection for Adapter input totals, cache buckets, unknown quantities, or the complete call set beyond the 128 displayed call snapshots.

## Resolution

Overview now selects Adapter usage when present and aggregates every sealed physical call before display truncation. Per call, it uses `inputTotalTokens` alone when known; otherwise it sums known input/cache buckets, then adds output. Missing terminal state or required quantities preserves the known subtotal as partial. An unsafe aggregate fails instead of losing integer precision. Insight visibly labels a partial metric even when its slot coverage is 1/1.

The regression exercises retry, failed and unknown calls, explicit zero, both input representations, idempotent duplicate snapshots, and 131 calls so the displayed list truncates while the Overview total still includes all calls. Old Attempts without an Adapter usage attachment remain unavailable and are not rewritten.

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `dd2ca6ce8afdead17822bf7cb71b24cc509ab2e5`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_4PYH2YWY2DWVN01S",
    "netake_MRQE2NQ74N0HSAVH",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/eval/test/external-usage.test.ts#necase_920FSWMBVEP3090H\"]}"
  ]
}
```
