---
format: concord.document/v1
id: reuse-pool-retired-entries-deadlock
title: 已修:复用池不摘除淘汰实例,容量被死实例占满后 acquire 永久挂起
createdAt: 2026-07-29T22:20:07+08:00
createdAtSource:
  kind: first-recorded
  path: memory/reuse-pool-retired-entries-deadlock.md
  commit: 2560d733e14dbbfc77bec57cd7dc5810f0023db2
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "# 已修:复用池不摘除淘汰实例,容量被死实例占满后 acquire 永久挂起"
    proof: []
    source:
      path: memory/reuse-pool-retired-entries-deadlock.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:2fb3d0fd7452966d2a2586b068f4e30d0b38f8d1e5975d2af3dbccaf998173ce
---
# 已修:复用池不摘除淘汰实例,容量被死实例占满后 acquire 永久挂起

- **现象**:sandbox 复用池里被淘汰(寿命确认失败 / reset 失败)的实例仍留在 `entries`,
  池容量被死实例占满后,后续 `acquire` 无实例可租也不再创建新实例,派发永久挂起。
- **根因**:淘汰只标记不摘除,容量判断按 `entries.length` 计,死实例占位。
- **修法**(2026-07-29,实现 ensureLifetime 契约时顺手修):淘汰实例从池 `entries` 中 splice
  移除;实例编号改为单调计数器,不复用已淘汰实例的编号。落点 `src/runner/sandbox-pool.ts`,
  配套测试 `src/runner/sandbox-pool.test.ts`(更换与不反复重建场景)。
