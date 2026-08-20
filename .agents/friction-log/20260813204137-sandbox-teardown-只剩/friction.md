---
title: 'Sandbox teardown 只剩 1ms deadline 导致 checkpoint 回存失败'
severity: 'major'
---

## Expected Behavior

Sandbox teardown 应获得独立、可配置且足以完成资源收尾的 deadline；特别是 checkpoint 回存不能只继承已耗尽的 attempt deadline。teardown 超时应清晰记录，同时不反改已经完成的任务 verdict。

## Current Behavior

MemoryBench Mempal 条件在 teardown 保存 checkpoint 时，NiceEval 传入的剩余 deadline 只有 1ms。任务 verdict 不受影响，但 checkpoint 可能未保存，从而破坏后续 attempt/run 的状态继承。

## Possible Solution

为 teardown 设置单独的 grace period 或生命周期 deadline，并在进入 hook 前保证最低预算；将 attempt verdict deadline 与资源清理/checkpoint deadline 分离。

## Minimal Reproducible Example

1. 运行一个接近 attempt timeout 的 Mempal attempt。
2. 在 Sandbox teardown hook 中保存 checkpoint。
3. 观察 hook 获得约 1ms 的剩余 deadline，保存来不及完成。
4. 当前 attempt verdict 仍可产生，但下一次状态恢复缺少可靠 checkpoint。

## Context

此问题出现在 MemoryBench 五条件正式批次。它不影响本批 verdict，却使后续纵向记忆状态是否继承存在风险。
