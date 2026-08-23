---
{
  "format": "niceeval.feedback/v1",
  "id": "20260813204135-niceeval-exp-无法一次精确选择多个离散实验",
  "title": "niceeval exp 无法一次精确选择多个离散实验",
  "state": "open",
  "reportedAt": "2026-08-13T20:41:35+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "product",
  "claim": "friction",
  "observation": "---\ntitle: 'niceeval exp 无法一次精确选择多个离散实验'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n`niceeval exp` 应允许一次 run 精确选择多个离散 experiment id，并让它们共享同一个全局并发闸与 Record writer；未选择的实验不应被运行。\n\n## Current Behavior\n\nMemoryBench 需要同时选择 Codex baseline、Mempal、Obelisk、Remem 和 Bub baseline，同时排除其它实验。CLI 没有正式的离散多选入口，只能拆成多个 shell/run，进一步放大 Record 单写者限制。\n\n## Possible Solution\n\n为 `niceeval exp` 增加可重复的 experiment selector 或显式 id 列表，并在 dry run、run metadata 与报告中保留选择集合。\n\n## Minimal Reproducible Example\n\n在一个包含五个目标实验和若干非目标实验的项目中，尝试用一条 `niceeval exp` 命令只选择五个不连续 id。当前没有可表达该集合的正式参数，只能分开运行或扩大选择范围。\n\n## Context\n\nMemoryBench 五条件正式比较因此拆成五个独立 shell 和五个 Record。下游曾记录同一问题；本条进入 NiceEval 上游 Frog 作为产品入口。\n",
  "impact": "MemoryBench 需要同时选择 Codex baseline、Mempal、Obelisk、Remem 和 Bub baseline，同时排除其它实验。CLI 没有正式的离散多选入口，只能拆成多个 shell/run，进一步放大 Record 单写者限制。",
  "memoryRelations": []
}
---
---
title: 'niceeval exp 无法一次精确选择多个离散实验'
severity: 'minor'
---

## Expected Behavior

`niceeval exp` 应允许一次 run 精确选择多个离散 experiment id，并让它们共享同一个全局并发闸与 Record writer；未选择的实验不应被运行。

## Current Behavior

MemoryBench 需要同时选择 Codex baseline、Mempal、Obelisk、Remem 和 Bub baseline，同时排除其它实验。CLI 没有正式的离散多选入口，只能拆成多个 shell/run，进一步放大 Record 单写者限制。

## Possible Solution

为 `niceeval exp` 增加可重复的 experiment selector 或显式 id 列表，并在 dry run、run metadata 与报告中保留选择集合。

## Minimal Reproducible Example

在一个包含五个目标实验和若干非目标实验的项目中，尝试用一条 `niceeval exp` 命令只选择五个不连续 id。当前没有可表达该集合的正式参数，只能分开运行或扩大选择范围。

## Context

MemoryBench 五条件正式比较因此拆成五个独立 shell 和五个 Record。下游曾记录同一问题；本条进入 NiceEval 上游 Frog 作为产品入口。
