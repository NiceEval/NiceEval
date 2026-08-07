---
title: '全量 unit 在 NixOS 被 E2B 测试硬编码路径与不完整 mock 阻断'
severity: 'minor'
---

## Expected Behavior

`pnpm test` 应在项目支持的 NixOS 开发机上运行完成，E2B provider 单测的 fake SDK 对象也应包含被错误路径调用的 `kill()`，使失败反映产品行为而非测试夹具。

## Current Behavior

全量 2,153 个用例中 5 个失败：3 个 `src/sandbox/e2b.test.ts` 的真实 wrapper 用 `spawn /bin/bash`，NixOS 没有 `/bin/bash`；2 个 downloadDirectory 用例在命令路径进入 retire 后调用 `this.sbx.kill()`，但测试 mock 没有 `kill`，抛出 TypeError。

## Possible Solution

真实 shell 测试通过可移植的 bash 解析（例如环境/工具定位）执行；E2B mock 统一由完整 fake factory 创建并实现 `kill()`，避免各用例漂移。

## Minimal Reproducible Example

在 NixOS 开发机运行 `pnpm test`。可稳定观察 `src/sandbox/e2b.test.ts` 中 3 个 `spawn /bin/bash ENOENT` 和 2 个 `this.sbx.kill is not a function`。本轮目标相关的 Compose/runtime/registry 单测、类型检查和 opt-in 真机 Docker 测试独立通过。

## Context

验证 Docker Compose timeout cleanup 核心修复时，全量回归被这 5 个未触碰 E2B 测试阻断，必须额外切片判定改动正确性。
