---
title: 'Runner lock heartbeat unit 在 main 虚拟时钟下间歇失败'
severity: 'minor'
---

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
