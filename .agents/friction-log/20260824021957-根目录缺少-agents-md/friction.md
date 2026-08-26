---
title: '根目录缺少 AGENTS.md 指定的 pnpm test 入口'
severity: 'minor'
---

## Expected Behavior

仓库根的测试入口与 AGENTS.md 一致；执行 `pnpm test` 能运行统一测试，或规则明确指向实际存在的命令。

## Current Behavior

根 `package.json` 没有 `test` script。执行 `pnpm test` 无输出并以状态 1 结束；执行 `pnpm run test` 才显示 `ERR_PNPM_NO_SCRIPT`。当前可用的验证入口是 `pnpm typecheck`、`pnpm lint` 与具名 `pnpm e2e test --repo migrate`。

## Possible Solution

在根 package 增加统一 `test` script，或把 AGENTS.md 的验证说明改为当前实际拥有的具名入口，避免把缺失 script 误判成产品测试失败。

## Minimal Reproducible Example

在仓库根运行 `pnpm test`，观察 exit code 1；再运行 `pnpm run test`，输出 `ERR_PNPM_NO_SCRIPT: Missing script: test`。

## Context

Record SPI 重构验收时，`build:package && pnpm test` 因缺失 script 停止，需另外检查 package scripts 后改跑 typecheck、lint 与 migrate E2E。
