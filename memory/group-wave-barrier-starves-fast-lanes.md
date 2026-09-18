---
format: concord.document/v1
id: group-wave-barrier-starves-fast-lanes
title: 跨 lane 连续 wave 闸让快 Group 空闲等待
createdAt: 2026-08-16T14:26:46+08:00
createdAtSource:
  kind: first-recorded
  path: memory/group-wave-barrier-starves-fast-lanes.md
  commit: 8d775bb00e86440fb7b0e0ada615405793d5602a
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [group-wave-barrier-starves-fast-lanes](group-wave-barrier-starves-fast-l\
      anes.md) — 连续跨 lane wave 闸让慢 Group 的下一槽挡住快 Group 后继，出现真实空闲与 timing
      空白；公平闸收窄为只保护各 lane 首槽"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 跨 lane 连续 wave 闸让快 Group 空闲等待

**现象**（2026-08-16）：多个 Eval Group 并跑时，快 Group 的前序已完成且全局并发位空闲，后继仍要等慢 Group 当前槽结束后才成批开始。等待发生在调度 Deferred 上，不进入 Attempt timing；Sandbox 的 `resetToAnchor` 也没有独立 timing 节点，因此页面同时出现真实空闲与时间轴空白。

**根因**：调度器把每条 lane 的第 N 个槽组成全局 wave，并要求 wave N 的全部成员至少取得一次并发位后才开放 wave N+1。慢 lane 的下一槽被自身 predecessor 阻挡，导致整波永远不能 settle，快 lane 更后的槽位随之饥饿。

**修法**：跨 lane 公平只保护每条 lane 的首槽。首槽全部得到一次机会后，各 lane 仅由自己的 predecessor 和并发限制推进，不再跨 lane 组成后续 wave。

**守护**：`e2e/runner/test/group-wave-gap-dispatch.test.ts` 让 gamma 首槽等待 alpha 与 beta 第三槽。旧实现先触发 10 秒 watchdog；修复后九条 Eval 全部 passed。
