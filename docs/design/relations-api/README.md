---
format: concord.document/v1
id: relations-api
title: Relations API
createdAt: 2026-08-12T11:57:58+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/relations-api/README.md
  commit: d7b0165d1752ba87558a100e03ab71ba7f4bccd0
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-1
  reason: 迁移保留 DECISION.md 中的明确裁决：plan-1
  source:
    path: docs/design/relations-api/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:8c6088f10dd88bbe2efa62cf338dcc3440c4a724ded7ba48993d75710ed78293
  targets: []
---
# Relations API

本决策比较多个 closed、Sample-aligned local projections 怎样形成跨 package relations。两项候选返回相同
relation value；区别是关系结构由 package owner 的函数私有解释，还是成为 host 可验证的公共声明。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1（推荐）：package-owned pure assembler](plans/plan-1/README.md)
- [PLAN-2：host-validated typed relation builder](plans/plan-2/README.md)
- [Decision](DECISION.md)
