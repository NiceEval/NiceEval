---
format: niceeval.memory/v1
id: show-score-outcomes-rendered-as-pass-rate
title: Show renders Score outcomes as a synthetic pass rate
createdAt: 2026-09-04
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS
      - nered_99F7WPXW2JB629D5
      - netake_40G7KZMW4Z54KAB6
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS"]}
promotions: []
---
## Problem

For an Experiment containing only `defineScoreEval` evaluations, `niceeval show` renders successful Score Attempts as `passed`, includes `Verdicts`, and computes a pass rate. If two Score Attempts complete and one errors, the human output reports `66.67%` even though no pass threshold exists.

## Root cause

The human renderer formats every Inspection aggregate through one Verdict-first layout. It already receives the aggregate `evaluationKind`, but uses that discriminator only to decide whether to append Score. Totals, Experiment columns, Attempt headings, Attempt values, and compact hidden-result summaries continue to use pass-oriented labels unconditionally.

## Repair boundary

Keep machine Inspection Verdict and metric facts unchanged. In the human `show` projection, pure Score aggregates display `Outcomes` and `Score`, omit Verdicts and Pass rate, render successful Attempts as `scored`, preserve `errored`, and omit the Pass rate column from pure Score Experiment tables. Mixed aggregates continue to expose both kinds of metric.
