---
title: 'E2E candidate 构建会短暂删除共享 link 消费的 dist'
severity: 'major'
---

## Expected Behavior

`pnpm e2e` 构建 candidate 时，当前工作树的 `dist/` 应原子替换，或在隔离输出目录构建；通过 `link:` 消费该工作树的真实下游不应观察到缺失的 package export。

## Current Behavior

运行 `pnpm e2e --repo report -- --run test/report-execution.test.ts` 期间，candidate build 会原地清理再重建 NiceEval 工作树的 `dist/`。并发运行的 MemoryBench `pnpm exec niceeval view` 从 `node_modules/niceeval -> NiceEval/record` 动态 import `dist/index.mjs` 时撞到清理窗口，报 `Cannot find module .../dist/index.mjs`。E2E 完成后文件重新出现，同一 view 命令恢复。

## Possible Solution

在临时目录构建 candidate，或把完整 dist 构建到 staging 后原子发布；不要让 candidate 打包过程暴露半构建的共享工作树。

## Minimal Reproducible Example

让下游以 `niceeval: link:../../NiceEval/record` 消费本工作树。一边运行根 `pnpm e2e --repo report -- --run test/report-execution.test.ts`，另一边反复运行下游 `pnpm exec niceeval view --no-open`。在 candidate build 清理 dist 的窗口会出现 `discovery.import-failed`，原因是 `dist/index.mjs` 不存在。

## Context

2026-08-16 在 `/home/ctrdh/.herdr/worktrees/MemoryBench/2-0` 真实 dogfood 时复现；E2E 结束后 `dist/index.mjs` 时间戳更新，同一 view 成功启动。
