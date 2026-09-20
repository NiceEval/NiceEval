---
format: concord.document/v1
id: observability-package-layout
title: Observability package layout
createdAt: 2026-08-12T11:57:58+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/observability-package-layout/README.md
  commit: d7b0165d1752ba87558a100e03ab71ba7f4bccd0
kind: design
alternatives:
  - plan-1
  - plan-2
  - source-receipt
decision:
  selected: source-receipt
  reason: 迁移保留 DECISION.md 中的明确裁决：source-receipt
  source:
    path: docs/design/observability-package-layout/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:5a97fab394c5d1083002b50875bc80c0142a0031a5a3e4aa3f4086dfbeeea0d5
  targets: []
---
# Observability package layout

本决策比较 Observability facts 在 RecordAttachment 中的物理切分。它不改变 Record Core、owner、
locator、closure 或 migration 公理，也不按 Report 想显示的列反向设计持久层。

本决策只比较 durable layout，不拥有通用 Projection API。当前 `RecordProjection` / `ProjectedSample` 可以消费
PLAN-1 的独立 Attachment family；Receipt、representation 与 physical package kind 只存在于未采用的 PLAN-2。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：七个逻辑 family](plans/plan-1/README.md)
- [PLAN-2：按采集权威切 physical packages](plans/plan-2/README.md)
- [Decision](DECISION.md)
