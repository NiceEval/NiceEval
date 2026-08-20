---
title: '默认 E2E 入口吞掉 regression 的非零退出码'
severity: 'major'
---

## Expected Behavior

`pnpm e2e --repo eval -- --run test/context.test.ts` 在所选 Repo 的测试失败、summary 分类为 `regression` 时，顶层命令应返回非零退出码。

## Current Behavior

同一次运行的 durable `summary.json` 显示 `results[0].exitCode: 1`、`category: regression`，receipt 的 test stage 也显示 `capture.exitCode: 1`，但外层 `pnpm e2e` 进程返回 0。CI 直接调用 `pnpm e2e run` 时仍能失败，因此当前主要影响本地诊断和脚本门禁。

## Possible Solution

默认 flow 在 run/summarize 完成后，把封闭的最终 category 映射到进程退出码；`regression`、`infra`、`configuration` 与非 signal cancellation 均不得被 plan/pack 成功覆盖。

## Minimal Reproducible Example

运行 `pnpm e2e --repo eval -- --run test/context.test.ts; echo $?`。当测试输出 `1 failed` 且 artifact root 下 `summary.json` 为 `category: regression` 时，观察 shell 仍打印 `0`。

## Context

定位线上 E2E 失败时，在 commit `93a8c50d`、Node 24.18.0、pnpm 11.18.0 下复现。对应 summary 位于本次临时 artifact root，未签入私有运行产物。
