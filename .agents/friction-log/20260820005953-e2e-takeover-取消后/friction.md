---
title: 'E2E takeover 取消后 cleanup 收据误报成功并残留进程组'
severity: 'major'
---

## Expected Behavior

`pnpm e2e takeover` 收到 Ctrl-C 后，应终止本次创建的全部 owned process group；takeover summary 只有在进程组确认消失后才能写 `cleanupOk: true` 并删除 scratch。

## Current Behavior

取消 `shared-state-lifecycle` takeover 的 `repo-default-parallel` 阶段后，summary 报告该 run `category: cancelled`、`cleanupOk: true` 且 scratch 已删除，但 PGID `552994` 仍有 `niceeval exp shared-state-pause-holder --rerun all --json` 与 esbuild 子进程存活，PPID 已变为 1。父流程必须额外对精确 PGID 执行 TERM/KILL 才能清理。

## Possible Solution

让 cancellation 路径等待 owned process-group supervisor 的终结确认后再写 cleanup receipt/删除 scratch；对暂停/恢复场景覆盖父进程退出和 reparent 后的组扫描，cleanup 失败必须 fail closed。

## Minimal Reproducible Example

运行 `pnpm e2e takeover --candidate <tgz> --repo runner -- --run test/shared-state-lifecycle.test.ts`，在 `takeover/repo-default-parallel` 的 pause-holder 活跃时发送 Ctrl-C。命令退出 130 且 summary 写 cleanup success；`pgrep -af niceeval-e2e-takeover-scratch` 仍能看到该 pause-holder 进程组。

## Context

本次 artifact 为 `/tmp/niceeval-pr64-takeover-sharedlifecycle-bguK1g/takeover-summary.json`；残留 PGID `552994` 已由父任务精确终止并确认消失。
