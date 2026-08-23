---
{
  "format": "niceeval.feedback/v1",
  "id": "20260813204138-bub-缺少-context",
  "title": "Bub 缺少 context compaction 导致长任务触及上下文窗口",
  "state": "open",
  "reportedAt": "2026-08-13T20:41:38+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'Bub 缺少 context compaction 导致长任务触及上下文窗口'\nseverity: 'major'\n---\n\n## Expected Behavior\n\nBub runner 应在长任务接近模型上下文窗口时执行可观察、可配置的 context compaction，并继续任务；报告应能区分 compaction 与真实任务失败。\n\n## Current Behavior\n\nMemoryBench Bub primary run 的 `react-tooltip/pr-1282` 因上下文窗口耗尽而 errored。Bub 没有可用的 compaction 路径，只能另开一次 one-slot fix-forward 才完成，造成同一正式条件被拆为 primary 与补跑。\n\n## Possible Solution\n\n在 runner 中增加基于 token budget 的自动 compaction，保留关键系统约束、任务状态和工具证据，并把 compaction 次数与前后 token 使用记录进 telemetry。\n\n## Minimal Reproducible Example\n\n运行 MemoryBench Bub baseline 的长任务 `react-tooltip/pr-1282`。primary run 在长工具轨迹后触及 context window 并 errored；新开干净上下文的单 slot fix-forward 可通过。\n\n## Context\n\nBub primary run id 为 `7aa5b902-56f1-4a66-b309-82fbfa4e7f51`；fix-forward run id 为 `36a3fcb5-cb7f-4b37-a474-8510849a2046`。\n",
  "impact": "MemoryBench Bub primary run 的 `react-tooltip/pr-1282` 因上下文窗口耗尽而 errored。Bub 没有可用的 compaction 路径，只能另开一次 one-slot fix-forward 才完成，造成同一正式条件被拆为 primary 与补跑。",
  "memoryRelations": []
}
---
---
title: 'Bub 缺少 context compaction 导致长任务触及上下文窗口'
severity: 'major'
---

## Expected Behavior

Bub runner 应在长任务接近模型上下文窗口时执行可观察、可配置的 context compaction，并继续任务；报告应能区分 compaction 与真实任务失败。

## Current Behavior

MemoryBench Bub primary run 的 `react-tooltip/pr-1282` 因上下文窗口耗尽而 errored。Bub 没有可用的 compaction 路径，只能另开一次 one-slot fix-forward 才完成，造成同一正式条件被拆为 primary 与补跑。

## Possible Solution

在 runner 中增加基于 token budget 的自动 compaction，保留关键系统约束、任务状态和工具证据，并把 compaction 次数与前后 token 使用记录进 telemetry。

## Minimal Reproducible Example

运行 MemoryBench Bub baseline 的长任务 `react-tooltip/pr-1282`。primary run 在长工具轨迹后触及 context window 并 errored；新开干净上下文的单 slot fix-forward 可通过。

## Context

Bub primary run id 为 `7aa5b902-56f1-4a66-b309-82fbfa4e7f51`；fix-forward run id 为 `36a3fcb5-cb7f-4b37-a474-8510849a2046`。
