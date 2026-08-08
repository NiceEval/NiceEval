---
title: 'e2e: `--repo <id>` 无匹配 lane 时静默选零并 exit 0'
severity: 'minor'
---

## Expected Behavior

显式 `pnpm e2e --repo <id>` 点名某 Repo 时，若 lane 过滤后为零，应非零退出并提示改用 `--lane`，让 CI 或用户不至于误以为跑过了。

## Current Behavior

`pnpm e2e --repo adapter/hermes`（默认 lane=pr）打印 `[e2e] no repos matched lane pr.` 后以 exit 0 结束：不 pack、不 run、无错误码。hermes/openclaw/opencode 只有 main/nightly/release lane，点名它们时全部静默落空。

## Possible Solution

plan/run 显式 `--repo` 命中清单但 lane 过滤结果为空时返回错误（非零）并提示可用 lane。

## Minimal Reproducible Example

仓库根运行 `pnpm e2e --repo adapter/hermes`，观察 `no repos matched lane pr.` 且 exit 0。

## Context

T3.4 adapter B 迁移验收：第一次用根 runner 点名 hermes 时被静默放行，靠读输出才发现要加 `--lane main`。
