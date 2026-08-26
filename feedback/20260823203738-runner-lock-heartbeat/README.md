---
format: niceeval.feedback/v2
id: 20260823203738-runner-lock-heartbeat
title: Runner lock heartbeat unit 在 main 虚拟时钟下间歇失败
state: open
reportedAt: 2026-08-23T20:37:38+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: bddd946758c4ea0ba06efba5e2e8036affb6daf6
subject: repository
claim: defect
observation: 在 origin/main（bddd94675）全量 unit 运行时，`packages/niceeval/src/runner/lock.test.ts` 的 `renews once per heartbeat period and never writes after release` 间歇失败：期望 `1970-01-01T00:16:41.000Z`，实际仍为 `1970-01-01T00:16:40.000Z`；随后单文件重跑通过。
impact: 与 Runner lock 无关的改动无法稳定取得完整 unit 绿灯，间歇失败会降低 CI 对真实回归的辨识度。
memoryRelations: []
adoptions:
  current: []
  history: []
---
# Runner lock heartbeat unit 在 main 虚拟时钟下间歇失败

## Expected Behavior

`pnpm exec vitest run --project unit` 应通过现有 case lock heartbeat owner；推进一个 heartbeat period 后，lease 时间应续期一次。

## Current Behavior

当前 origin/main（bddd94675）中，全量 unit 运行时 `packages/niceeval/src/runner/lock.test.ts` 的 `renews once per heartbeat period and never writes after release` 失败；期望 `1970-01-01T00:16:41.000Z`，实际仍为 `1970-01-01T00:16:40.000Z`。随后单文件重跑通过，表现为调度相关的间歇失败。

## Possible Solution

核对 heartbeat fiber 在 TestClock 推进前是否已经进入 sleep，并明确测试所需的 fiber 调度/yield 边界。

## Minimal Reproducible Example

```sh
pnpm exec vitest run --project unit packages/niceeval/src/runner/lock.test.ts
```

该命令可能通过；失败收据来自同一 checkout 的全量 `--project unit` 运行。

## Context

在纯文件组织的 Record 重构基于最新 origin/main 验收时发现；本次改动未触碰 Runner lock 实现或测试。
