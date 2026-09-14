---
format: concord.document/v1
id: concurrency-strict-retry-order
title: 让重复运行严格按顺序发生
createdAt: 2026-07-27T18:06:13+08:00
kind: use-case
feature: docs/feature/experiments/README.md
---

# 让重复运行严格按顺序发生

`attempts > 1` 且 `earlyExit` 需要“第一次通过就不再派发”时，把 Experiment 设为 `maxConcurrency: 1`。
每道 Eval 的第一次完成后，Runner 才决定是否需要下一次。

不串行时，多次 Attempt 可能已经同时派发，`earlyExit` 只能省掉尚未开跑的部分。
只想缩短“能否做到”的验证时，完整入口见 [`--early-exit`](early-exit.md)。
