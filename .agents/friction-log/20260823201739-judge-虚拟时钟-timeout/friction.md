---
title: 'Judge 虚拟时钟 timeout unit 在 main 稳定失败'
severity: 'minor'
---

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
