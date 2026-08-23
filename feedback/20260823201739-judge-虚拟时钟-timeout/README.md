---
format: niceeval.feedback/v1
id: 20260823201739-judge-虚拟时钟-timeout
title: Judge 虚拟时钟 timeout unit 在 main 稳定失败
state: open
reportedAt: 2026-08-23T20:17:39+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: bddd946758c4ea0ba06efba5e2e8036affb6daf6
subject: repository
claim: defect
observation: 在 origin/main（bddd94675）运行 `pnpm exec vitest run --project unit packages/niceeval/src/assertions/judge.test.ts` 时，`timeout stays pending before its boundary, then interrupts the provider request` 稳定失败，断言位置为第 120 行。
impact: 与 Judge 无关的 Record 文件组织重构无法取得完整 unit 绿灯，后续改动也无法依靠该 owner 区分真实回归与基线失败。
memoryRelations: []
---
# Judge 虚拟时钟 timeout unit 在 main 稳定失败

## Expected Behavior

`pnpm exec vitest run --project unit` 在与 Judge 无关的改动上应通过现有 Judge timeout owner。

## Current Behavior

当前 origin/main（bddd94675）中，`packages/niceeval/src/assertions/judge.test.ts` 的 `timeout stays pending before its boundary, then interrupts the provider request` 失败；单文件重跑也稳定失败，断言位置为第 120 行。

## Possible Solution

核对 timeout 结果当前是否仍应携带断言要求的第三个字段，并修正生产行为或已漂移的 owner expected。

## Minimal Reproducible Example

```sh
pnpm exec vitest run --project unit packages/niceeval/src/assertions/judge.test.ts
```

## Context

在 Record 文件组织重构的全量 unit 验收中发现。该重构未修改 Judge 代码或测试，因此本轮不顺手修正。
