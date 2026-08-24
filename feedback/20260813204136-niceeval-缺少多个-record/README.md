---
format: niceeval.feedback/v2
id: 20260813204136-niceeval-缺少多个-record
title: NiceEval 缺少多个 Record 的正式合并入口
state: open
reportedAt: 2026-08-13T20:41:36+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
subject: product
claim: friction
observation: |
  ---
  title: 'NiceEval 缺少多个 Record 的正式合并入口'
  severity: 'major'
  ---

  ## Expected Behavior

  当并行或故障恢复使同一批实验产生多个 Record 时，NiceEval 应提供正式合并入口，校验身份与冲突后生成一个可由 show、view 和 report 消费的统一 Record。

  ## Current Behavior

  NiceEval 没有 Record merge 命令或 API。MemoryBench 五个独立 shell 因单写者锁各自写入隔离 Record，完成后只能永久保留整个约 813MB 的结果树；不能生成一个统一正式结果，也不能通过官方入口跨 Record 汇总。

  ## Possible Solution

  提供 `niceeval record merge` 或等价 API，定义 run/attempt id 冲突、attachment 去重、provenance、原子输出、失败恢复和只读源 Record 语义。

  ## Minimal Reproducible Example

  1. 分别在 Record A 与 Record B 完成两个不重叠实验。
  2. 尝试用 NiceEval CLI/API 生成同时包含 A、B 的新 Record。
  3. 当前没有正式入口，只能分别查看或自行操作私有产物。

  ## Context

  正式结果保留在 `/home/ctrdh/.herdr/memorybench-five-KEhUrv`，约 813MB。两份失败临时副本另移至可恢复目录，但不能替代正式合并。
impact: NiceEval 没有 Record merge 命令或 API。MemoryBench 五个独立 shell 因单写者锁各自写入隔离 Record，完成后只能永久保留整个约 813MB 的结果树；不能生成一个统一正式结果，也不能通过官方入口跨 Record 汇总。
memoryRelations: []
adoptions:
  current: []
  history: []
---
---
title: 'NiceEval 缺少多个 Record 的正式合并入口'
severity: 'major'
---

## Expected Behavior

当并行或故障恢复使同一批实验产生多个 Record 时，NiceEval 应提供正式合并入口，校验身份与冲突后生成一个可由 show、view 和 report 消费的统一 Record。

## Current Behavior

NiceEval 没有 Record merge 命令或 API。MemoryBench 五个独立 shell 因单写者锁各自写入隔离 Record，完成后只能永久保留整个约 813MB 的结果树；不能生成一个统一正式结果，也不能通过官方入口跨 Record 汇总。

## Possible Solution

提供 `niceeval record merge` 或等价 API，定义 run/attempt id 冲突、attachment 去重、provenance、原子输出、失败恢复和只读源 Record 语义。

## Minimal Reproducible Example

1. 分别在 Record A 与 Record B 完成两个不重叠实验。
2. 尝试用 NiceEval CLI/API 生成同时包含 A、B 的新 Record。
3. 当前没有正式入口，只能分别查看或自行操作私有产物。

## Context

正式结果保留在 `/home/ctrdh/.herdr/memorybench-five-KEhUrv`，约 813MB。两份失败临时副本另移至可恢复目录，但不能替代正式合并。
