---
{
  "format": "niceeval.feedback/v1",
  "id": "20260809124939-experiment-官方视图没有统一的人读短名投影",
  "title": "Experiment 官方视图没有统一的人读短名投影",
  "state": "open",
  "reportedAt": "2026-08-09T12:49:39+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: 'Experiment 官方视图没有统一的人读短名投影'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\nExperiment 应允许作者声明与稳定 `experimentId` 分离的人读短名；官方 `ExperimentScatter`、`ExperimentTable` 和下钻标题应统一显示短名，同时继续用完整 id 做身份键与链接参数。\n\n## Current Behavior\n\n`ExperimentAuthorFields` 只有 `description` 与报告归类用 `labels`，没有统一 `shortName` / display label 契约。MemoryBench 只能在 `reports/components/leaderboard.tsx` 里用 `labels.line + flags.memory` 手写 `codex+nowledge` 等短名；官方 `ExperimentScatter` 的 `experiment` 分组函数仍直接返回 `subject.experimentId`，并以 `point=\"experiment\"` 显示完整 id。`ExperimentTable` 同样只把 `experimentId` 作为主名称。因此同一页榜单是短名，散点和表格是长 id。\n\n## Possible Solution\n\n先定稿身份键与展示标签分离的公共契约：可以是 Experiment 自身的人读字段，也可以是官方可复用的 display projection，但必须由 `ExperimentScatter`、`ExperimentTable`、详情标题与自定义报告共同消费，不能要求每个下游复制字符串拼接。\n\n## Minimal Reproducible Example\n\n1. 在 MemoryBench 打开报告页。\n2. 对比榜单中的 `codex+nowledge` 与散点中的 `codex-gpt-5.6-luna--nowledge`。\n3. 代码证据：`reports/components/leaderboard.tsx` 手写 `displayName()`；`src/report/model/calculation.ts` 的 `experiment` 返回完整 id；`src/report/components/summaries/index.tsx` 固定 `point=\"experiment\"`；`src/report/components/entity-lists/compute.ts` 仅输出 `experimentId`。\n\n## Context\n\nMemoryBench commit `4f39607` 在 2026-07-25 明确加入了“人读短名”，但范围只在排行榜。commit `f309011` 在 2026-07-29 切换官方 Experiment 视图后没有补统一展示名契约。当前 GitHub issue / PR 与既有 Frog 均未跟踪此缺口。\n",
  "impact": "`ExperimentAuthorFields` 只有 `description` 与报告归类用 `labels`，没有统一 `shortName` / display label 契约。MemoryBench 只能在 `reports/components/leaderboard.tsx` 里用 `labels.line + flags.memory` 手写 `codex+nowledge` 等短名；官方 `ExperimentScatter` 的 `experiment` 分组函数仍直接返回 `subject.experimentId`，并以 `point=\"experiment\"` 显示完整 id。`ExperimentTable` 同样只把 `experimentId` 作为主名称。因此同一页榜单是短名，散点和表格是长 id。",
  "memoryRelations": []
}
---
---
title: 'Experiment 官方视图没有统一的人读短名投影'
severity: 'minor'
---

## Expected Behavior

Experiment 应允许作者声明与稳定 `experimentId` 分离的人读短名；官方 `ExperimentScatter`、`ExperimentTable` 和下钻标题应统一显示短名，同时继续用完整 id 做身份键与链接参数。

## Current Behavior

`ExperimentAuthorFields` 只有 `description` 与报告归类用 `labels`，没有统一 `shortName` / display label 契约。MemoryBench 只能在 `reports/components/leaderboard.tsx` 里用 `labels.line + flags.memory` 手写 `codex+nowledge` 等短名；官方 `ExperimentScatter` 的 `experiment` 分组函数仍直接返回 `subject.experimentId`，并以 `point="experiment"` 显示完整 id。`ExperimentTable` 同样只把 `experimentId` 作为主名称。因此同一页榜单是短名，散点和表格是长 id。

## Possible Solution

先定稿身份键与展示标签分离的公共契约：可以是 Experiment 自身的人读字段，也可以是官方可复用的 display projection，但必须由 `ExperimentScatter`、`ExperimentTable`、详情标题与自定义报告共同消费，不能要求每个下游复制字符串拼接。

## Minimal Reproducible Example

1. 在 MemoryBench 打开报告页。
2. 对比榜单中的 `codex+nowledge` 与散点中的 `codex-gpt-5.6-luna--nowledge`。
3. 代码证据：`reports/components/leaderboard.tsx` 手写 `displayName()`；`src/report/model/calculation.ts` 的 `experiment` 返回完整 id；`src/report/components/summaries/index.tsx` 固定 `point="experiment"`；`src/report/components/entity-lists/compute.ts` 仅输出 `experimentId`。

## Context

MemoryBench commit `4f39607` 在 2026-07-25 明确加入了“人读短名”，但范围只在排行榜。commit `f309011` 在 2026-07-29 切换官方 Experiment 视图后没有补统一展示名契约。当前 GitHub issue / PR 与既有 Frog 均未跟踪此缺口。
