---
format: niceeval.memory/v1
id: insight-aggregate-hides-partial-state
title: Insight aggregate row hides an intrinsic partial metric
createdAt: 2026-09-21
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_JSKXSEVB12GTC5M2
      - netake_NFCA10NRSR3KP9R6
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-snapshot.browser.spec.ts#necase_DCFSBPFARWB0QD6D"]}
promotions: []
---
## Problem

The collapsed Insight experiment row renders a known token subtotal without its `partial` marker even though the public Overview cell has `state: "partial"` and full slot coverage. Expanding to the Attempt row reveals the marker, so the hierarchy presents the same metric inconsistently.

## Root cause

`MetricCellView` used `showCoverage` as a gate for both slot coverage (`samples < total`) and the metric's intrinsic `partial` state. Experiment aggregate rows intentionally pass `showCoverage=false` to suppress compact `samples/total` noise, which accidentally suppressed the independent domain state too.

## Resolution

Treat intrinsic `cell.state === "partial"` independently from slot coverage. `showCoverage=false` hides only the `samples/total` coverage annotation; a known subtotal remains visibly marked partial with its explanatory title.
