---
format: niceeval.memory/v1
id: view-run-selection-is-ignored
title: view --run 未将 Insight Overview 收窄到所选 Run
createdAt: 2026-08-29
kind:
  type: problem
  state: open
promotions: []
---
## Problem

运行 `niceeval view --run <run-id>` 时，CLI 已把 exact Run 写入 loopback View URL，但浏览器初始 Overview 仍显示同组的其它 Run / Experiment，用户无法从指定 Run 开始审阅。

## Root cause

Insight SPA 路由重构后没有读取 `window.location.search` 中重复的 `run` 参数，也没有把选择传给 manifest 的默认分组和 Overview cell member 投影。现有浏览器 Journey 覆盖 View 授权、层级审阅与 sealed cutoff，却没有从安装后 CLI 入口启动带 `--run` 的 View。

## Expected resolution

安装后的 `niceeval view --run <run-id>` 应打开包含该 Run 的分组，并把初始 Overview 收窄为所选 exact Run；同组未选择的结果不可见。没有 `--run` 时保持完整当前 Overview，Run / Attempt 路由继续可分享。
