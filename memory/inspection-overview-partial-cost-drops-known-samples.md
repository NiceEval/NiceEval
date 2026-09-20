---
format: concord.document/v1
id: inspection-overview-partial-cost-drops-known-samples
title: Inspection Overview drops known costs when coverage is partial
createdAt: 2026-09-04
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - nered_MEV73PEC01ZTZ08D
            - netake_Y35M8M11HP6J5GW9
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/inspection-query.test.ts#necase_79TQ9VGG316D8FK0"]}
    proof:
      - nered_MEV73PEC01ZTZ08D
      - netake_Y35M8M11HP6J5GW9
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/inspection/test/inspection-query.test.ts#necase_79TQ9VGG316D8FK0"]}
    source:
      path: memory/inspection-overview-partial-cost-drops-known-samples.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:14ae97122a1490914b1c6d8f30f92f2620ffbe73a514c32fa078c626c2790777
---
## Problem

Inspection `overview.get` returns `unavailable` with a null value when an aggregate contains known observed or estimated cost samples plus one or more Attempts without cost data. Cell, Experiment, path-group, and totals therefore discard paid-cost evidence that remains valid.

## Root cause

`costForSlots` required one cost source to cover every selected subject before choosing it. That condition conflated incomplete coverage with absence: as soon as one eligible Attempt lacked both sources, the function selected no source and erased all known samples.

## Required behavior

Cost aggregation keeps observed and estimated facts separate, chooses the source with the greatest sample coverage, and prefers observed when coverage ties. Missing samples make the metric `partial`, while known `value`, `samples`, `total`, `bounds`, `source`, Attempt `refs`, and `issues` remain observable at member, cell, Experiment, path-group, and totals scopes.
