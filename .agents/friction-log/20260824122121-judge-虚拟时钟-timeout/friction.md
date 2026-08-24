---
title: 'Judge 虚拟时钟 timeout issue 在 unit 套件中稳定缺失'
severity: 'major'
---

## Expected Behavior

`pnpm exec vitest run --project unit` 应在未触及 Judge 的 Report 改动上稳定通过，Judge 虚拟时钟用例应在 999ms 保持 pending、到 1000ms 返回带 timeout issue 的 unavailable。

## Current Behavior

全量 unit 在 `packages/niceeval/src/assertions/judge.test.ts:120` 稳定失败；同文件窄重跑也立即复现。结果仍是 `state: unavailable` / `reason: source-unavailable`，但缺少断言期待的 timeout issue，因此 7 files 中 1 file、15 tests 中 1 test 失败。当前 Report 变更未触及 Judge 源码或测试。

## Possible Solution

核对 Effect 3.22.1 下 TestClock、timeout 与 provider interruption 的调度顺序，确保 Fiber 在边界前确实挂起，并让 timeout failure 在 source-unavailable 归一时保留预期 issue；随后让该用例连续与全量都稳定通过。

## Minimal Reproducible Example

在仓库根运行：

```bash
pnpm exec vitest run --project unit packages/niceeval/src/assertions/judge.test.ts
```

当前稳定得到 `packages/niceeval/src/assertions/judge.test.ts:120` 的 `toMatchObject` 失败，3 passed / 1 failed。

## Context

在修复 Report Header 实验选择器并完成 Report E2E reliability takeover 后执行全仓 unit 验收时发现。该红灯独立于本次 Report 路径，但会阻止把全仓 unit 宣称为全绿。
