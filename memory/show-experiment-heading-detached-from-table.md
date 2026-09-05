---
format: niceeval.memory/v1
id: show-experiment-heading-detached-from-table
title: Show Experiment heading is detached from its table
createdAt: 2026-08-28
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "red: nered_T14PWWB7GN7FFG9D"
      - "takeover: netake_2EPSHS9C8K6S2NQB"
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/show-experiment-spacing.test.ts#necase_NRD2EXM6620FRXHN"]}
promotions: []
---
## Problem

`niceeval show` renders each `Experiment <id>` heading with a blank line after it before the `Eval / Attempt / Score` table. The heading is therefore visually closer to the preceding Experiment table than to the table it owns.

## Root cause

The shared terminal block renderer inserts spacing before every non-divider block even when the preceding block is a divider. The Show Overview represents an Experiment heading as a divider followed by its table, so the generic spacing rule separates the heading from its owned table.

## Expected resolution

The installed CLI must render a blank line before each subsequent Experiment section, then place `Experiment <id>` immediately adjacent to its following `Eval / Attempt / Score` table header. Other panels and non-divider block spacing must remain unchanged.

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `f75021ab2f3b9e42e079bda7b25b4dd3f71fdb8d`

```json
{
  "kind": "fixed",
  "proof": [
    "red: /tmp/niceeval-e2e-artifacts-3e5UZr/report/receipt.json",
    "green: /tmp/niceeval-e2e-artifacts-N2KVHv/report/receipt.json"
  ]
}
```

### Reopened at `f75021ab2f3b9e42e079bda7b25b4dd3f71fdb8d`

```json
{
  "kind": "fixed",
  "proof": [
    "red: nered_EBEWBSJXA9DWH1TE",
    "takeover: netake_NRWAXFBS12YQKJQB",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS\"]}"
  ]
}
```

### Reopened at `b3d673420ec09bfeeb65a0610f53960af02be7fe`

```json
{
  "kind": "fixed",
  "proof": [
    "red: nered_93EYDKQ33V7N56EY",
    "takeover: netake_QD1H6K6YCY2266QZ",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/inspection/test/show-experiment-spacing.test.ts#necase_NRD2EXM6620FRXHN\"]}"
  ]
}
```
