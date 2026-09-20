---
format: concord.document/v1
id: claude-sdk-concurrent-hitl-approve-race
title: claude-sdk-concurrent-hitl-approve-race
createdAt: 2026-07-03T20:16:57+08:00
createdAtSource:
  kind: first-recorded
  path: memory/claude-sdk-concurrent-hitl-approve-race.md
  commit: e842f5e0d2544cd1091af51a10a0c0c490f2458d
description: 两条 HITL eval 并发跑在同一个 claude-sdk server 实例上时,POST /api/chat/approve 会永久 404,不是瞬时竞态——必须串行或每个 attempt 独立 server 实例
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：`examples/zh/tier1/claude-sdk` 的 `hitl-approve.eval.ts` 和 `hitl-deny.eval.ts` 单独跑
(`niceeval exp assistant hitl-approve`)各自 100% 通过,但两条一起跑(`niceeval exp assistant`,
`maxConcurrency: 2`,两者都不带 model 因此共用同一个"default"分桶 server 实例)时,
`hitl-approve` 稳定地在 `POST /api/chat/approve` 上收到
`404 {"error":"no pending approval for toolUseId ..."}`——即使把这个请求加上 3 秒、150ms 间隔
的重试也一样,不是瞬时竞态,是这个 toolUseId 对应的 `canUseTool` 回调**根本没有**把 resolver
写进服务端的 `pendingApprovals` Map。

**根因**：`examples/zh/origin/claude-sdk/src/backend/agent.ts` 每次 `POST /api/chat` 都会
`query()` 一次,SDK 内部 spawn 一个 claude-code CLI 子进程。两个并发请求打到同一个
`node:http` server 实例时,会同时 spawn 两个 CLI 子进程——`pendingApprovals`
(`src/backend/pending-approvals.ts`)是这个 Node 进程里的模块级单例 Map,理论上按
`toolUseId` 隔离不该冲突,但实测两个并发 CLI 子进程同时触发 `canUseTool` 时,其中一个请求的
`resolve` 从未被注册成功(具体是 CLI 子进程间资源竞争,还是 SDK 内部状态在两个并发
`query()` 之间没有完全隔离,没有继续深挖——现象层面确定的是"并发时必现,串行时不发生")。

**修法 / 适用场景**：
- niceeval 侧的 workaround:`niceeval.config.ts` 把 `maxConcurrency` 设成 1(牺牲速度换正确性),
  或者给 HITL 类 eval 单独跑(`niceeval exp assistant hitl-approve`、
  `niceeval exp assistant hitl-deny` 分两次调用)。
- adapter 侧更彻底的修法(本次未做,标注为后续可选项):`agents/server-lifecycle.ts` 的
  `ensureServer` 目前按 `model` 分桶复用同一个进程;要支持同 model 下的真并发 HITL,需要改成
  每个 attempt/session 各自一个独立 server 实例(每次 `send` 且 `ctx.session.isNew` 时都
  `ensureServer` 一个新实例),但这样会显著增加 spawn 开销,对这个 demo 级别的 eval 覆盖不
  值得,先记录不做。
- 这不是 adapter 的帧映射 bug——两条 eval 单独跑各自的 SSE 帧解析、HITL 挂起/续读、
  `status: rejected` 映射全部正确;只在"两个 HITL 审批并发对着同一个 claude-code 子进程"这个
  窄场景下才复现。其它四个应用(pi-sdk 的服务端内存 session、codex-sdk 无 HITL、langgraph/
  ai-sdk-v7 没验证过这个具体场景)不确定是否有相同问题,接入时如果 HITL eval 并发跑挂了,
  先怀疑这个,别急着改帧映射逻辑。
