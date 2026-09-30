---
format: concord.document/v1
id: insight-aggregate-hides-partial-state
title: Insight aggregate row hides an intrinsic partial metric
createdAt: 2026-09-21
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: Preserved historical resolution declaration during merge; not current
    verification.
  at: 2026-09-29T23:47:24.368Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: >-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - nered_JSKXSEVB12GTC5M2
            - netake_NFCA10NRSR3KP9R6
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-snapshot.browser.spec.ts#necase_DCFSBPFARWB0QD6D"]}
    proof:
      - nered_JSKXSEVB12GTC5M2
      - netake_NFCA10NRSR3KP9R6
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/insight/test/view-snapshot.browser.spec.ts#necase_DCFSBPFARWB0QD6D"]}
    source:
      path: memory/insight-aggregate-hides-partial-state.md
      commit: 05dec8c7f1795e13212d424ee472874d62d84345
      digest: sha256:df105438d70ce8fefda72985a33c18db60d63b037ac348a0a5d0ac3bea13fe3a
---
## Problem

The collapsed Insight experiment row renders a known token subtotal without its `partial` marker even though the public Overview cell has `state: "partial"` and full slot coverage. Expanding to the Attempt row reveals the marker, so the hierarchy presents the same metric inconsistently.

## Root cause

`MetricCellView` used `showCoverage` as a gate for both slot coverage (`samples < total`) and the metric's intrinsic `partial` state. Experiment aggregate rows intentionally pass `showCoverage=false` to suppress compact `samples/total` noise, which accidentally suppressed the independent domain state too.

## Resolution

Treat intrinsic `cell.state === "partial"` independently from slot coverage. `showCoverage=false` hides only the `samples/total` coverage annotation; a known subtotal remains visibly marked partial with its explanatory title.
