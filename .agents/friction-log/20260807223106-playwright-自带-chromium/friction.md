---
title: 'Playwright 自带 chromium 在 NixOS 缺系统库无法启动，e2e/report 需 CHROMIUM_EXECUTABLE_PATH 指向系统 chromium'
severity: 'minor'
---

## Expected Behavior
在 NixOS 开发机上 `pnpm e2e --repo report` 应能直接驱动 Playwright 浏览器完成 report 的浏览器验收。

## Current Behavior
Playwright 自带 chromium headless shell（chrome-headless-shell-1228，postinstall 下载的 ubuntu24.04 fallback build）启动失败：`error while loading shared libraries: libglib-2.0.so.0`。NixOS 不在 ldconfig 提供其动态依赖（libglib-2.0、libnss3 等 22 个缺失），3 个浏览器测试全部以 browserType.launch 失败告终（归 infra，不是断言问题）。

## Possible Solution
- 短期：`e2e/report/playwright.config.ts` 已加 `CHROMIUM_EXECUTABLE_PATH` 钩子（未设置时行为不变，CI 不受影响）；本机运行时 `CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/chromium pnpm e2e --repo report`，系统 chromium（Nix wrapper 自带依赖）可被正常驱动。
- 长期：给 Playwright 自带浏览器补齐系统库，或把钩子扩展为默认探测 `which chromium`，让后续 agent 免环境变量直接跑通。

## Minimal Reproducible Example
```sh
pnpm e2e --repo report   # 无 CHROMIUM_EXECUTABLE_PATH 时浏览器 leg 必挂
```

## Context
- 复现环境：NixOS 26.11，`/run/current-system/sw/bin/chromium` 存在且可被 Playwright 驱动（`chromium.launch({ executablePath })` 冒烟通过）。
- 已在 2026-08-07 e2e/report 浏览器验收轮中发现并就地加了钩子；本条目保留给后续 NixOS 开发机与 CI 环境差异排查。
