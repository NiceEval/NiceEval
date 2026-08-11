---
title: 'pnpm lint 在文档任务中先跑 prepare 并被无关源码类型错误阻断'
severity: 'minor'
---

## Expected Behavior

只修改 `docs/`、`docs-site/` 与 `memory/` 时，统一 `pnpm lint` 应能运行文档规则；依赖状态检查不应先触发完整 package prepare，或至少应提供不会被无关源码构建阻断的统一文档验收入口。

## Current Behavior

`pnpm lint` 先执行依赖状态检查，并间接运行 `pnpm install` 的 `prepare`。`prepare` 在 `scripts/package-runtime/build.mjs` 生成声明时，被未触碰的 `src/record/store/backend.ts` 与 `src/record/store/graph-access.ts` 共 8 个既有 TypeScript 错误阻断，因此统一 lint 尚未进入文档项目。直接运行 `vitest --project lint-docs` 与 `vitest --project lint-docs-site` 均通过。

## Possible Solution

让 lint 的依赖状态检查使用不会执行 lifecycle scripts 的模式，或让 `pnpm lint` 直接进入 lint projects；保留 package build/typecheck 为独立验证，不让无关源码失败遮蔽文档规则结果。

## Minimal Reproducible Example

在当前 checkout 只保留文档改动，运行 `pnpm lint`。可稳定观察 `prepare` 先执行，随后在 `src/record/store/backend.ts` 和 `src/record/store/graph-access.ts` 的既有声明错误处退出；改跑 `./node_modules/.bin/vitest run --project lint-docs` 则 7 files / 26 tests 全通过。

## Context

收口新的 Record 架构文档时，需要额外运行两个底层 Vitest project 才能证明文档规则通过，并手工区分统一入口失败与本次改动无关。
