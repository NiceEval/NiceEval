---
format: concord.document/v1
id: projection-api
title: Projection API
createdAt: 2026-08-12T11:57:58+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/projection-api/README.md
  commit: d7b0165d1752ba87558a100e03ab71ba7f4bccd0
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-1
  reason: 迁移保留 DECISION.md 中的明确裁决：plan-1
  source:
    path: docs/design/projection-api/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:8cd566b7d2c81c5a28c80978f36abf4e5e2013a0277f55ce2737fcfea515a8b2
  targets: []
---
# Projection API

本决策比较 Report 或分析脚本怎样声明从 Sample owner package 到 local typed views 的读取。两项候选拥有
相同输入输出；区别是 host 是否在 I/O 前知道完整依赖图。参数化的 layout state 让本决策不依赖
[Observability package layout](../observability-package-layout/README.md) 的最终裁决。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1（推荐）：runtime direct calls](plans/plan-1/README.md)
- [PLAN-2：static finite graph](plans/plan-2/README.md)
- [Decision](DECISION.md)
