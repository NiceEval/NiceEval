---
format: concord.document/v1
id: record-runtime
title: Record access runtime
createdAt: 2026-08-12T12:21:45+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/record-runtime/README.md
  commit: 9e506b2bf91dc4a58cf1283ae62da46a1e659080
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-2
  reason: 迁移保留 DECISION.md 中的明确裁决：plan-2
  source:
    path: docs/design/record-runtime/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:65b5d727546845739292a62b2d65b97ef9876bb15686557e9d7d963edee118e5
  targets: []
---
# Record access runtime

本决策比较同一 host operation 怎样拥有 Record root 的本地运行资源。Record facts、Core、Attachment、
`FrozenRecordView` 与写入语义保持不变；候选只改变 root identity、snapshot generation、locks 和 verified
read cache 的资源 owner。

现有契约已经统一“读什么”：`RecordReader` 与 `RecordWriteSession.view` 都是完整
`FrozenRecordView`。本决策只比较不同 open 是否共享同一个 root-affine runtime guarantee。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：各 open 独立拥有资源](plans/plan-1/README.md)
- [PLAN-2（推荐）：统一 RecordAccessRuntime substrate](plans/plan-2/README.md)
- [Decision](DECISION.md)
