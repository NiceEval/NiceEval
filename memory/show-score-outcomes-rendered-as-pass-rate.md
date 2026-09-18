---
format: concord.document/v1
id: show-score-outcomes-rendered-as-pass-rate
title: Show renders Score outcomes as a synthetic pass rate
createdAt: 2026-09-04
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
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
            - e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS
            - nered_99F7WPXW2JB629D5
            - netake_40G7KZMW4Z54KAB6
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS"]}
    proof:
      - e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS
      - nered_99F7WPXW2JB629D5
      - netake_40G7KZMW4Z54KAB6
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS"]}
    source:
      path: memory/show-score-outcomes-rendered-as-pass-rate.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:a4d20b08beb3add8419f52e1316466d93d8af6876338d1eee66eac70f5e0edfa
---
## Problem

For an Experiment containing only `defineScoreEval` evaluations, `niceeval show` renders successful Score Attempts as `passed`, includes `Verdicts`, and computes a pass rate. If two Score Attempts complete and one errors, the human output reports `66.67%` even though no pass threshold exists.

## Root cause

The human renderer formats every Inspection aggregate through one Verdict-first layout. It already receives the aggregate `evaluationKind`, but uses that discriminator only to decide whether to append Score. Totals, Experiment columns, Attempt headings, Attempt values, and compact hidden-result summaries continue to use pass-oriented labels unconditionally.

## Repair boundary

Keep machine Inspection Verdict and metric facts unchanged. In the human `show` projection, pure Score aggregates display `Outcomes` and `Score`, omit Verdicts and Pass rate, render successful Attempts as `scored`, preserve `errored`, and omit the Pass rate column from pure Score Experiment tables. Mixed aggregates continue to expose both kinds of metric.
