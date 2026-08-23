---
{
  "format": "niceeval.feedback/v1",
  "id": "20260806205427-deepseek-v4-flash",
  "title": "DeepSeek V4 Flash 的 #low/#max 预设无法启动",
  "state": "open",
  "reportedAt": "2026-08-06T20:54:27+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'DeepSeek V4 Flash 的 #low/#max 预设无法启动'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\nAGENTS.md 中的 `flash-low-researcher` 与 `flash-max-worker` 预设可以直接启动，并固定对应 effort。\n\n## Current Behavior\n\n使用 `opencode-go/deepseek-v4-flash#low` 或 `opencode-go/deepseek-v4-flash#max` 时，OpenCode 因模型变体无法解析而退出，worker 没有进入可提示状态。只有裸模型 `opencode-go/deepseek-v4-flash` 能启动，因此绕行会失去 low/max 档位固定。\n\n## Possible Solution\n\n校准 provider 实际支持的模型引用，或更新两个预设与就绪检查，让无效变体在创建 worker 前给出明确错误。\n\n## Minimal Reproducible Example\n\n```sh\nherdr agent start audit --kind opencode --pane PANE_ID --timeout 120000 -- \\\n  --mini --model opencode-go/deepseek-v4-flash#low --auto\n```\n\n把 `#low` 改成 `#max` 结果相同。\n\n## Context\n\n父 agent 必须识别失败 pane、读取现场、关闭 pane，再用裸模型重启。该问题在同一任务中用 low 与 max 各复现一次。\n",
  "impact": "使用 `opencode-go/deepseek-v4-flash#low` 或 `opencode-go/deepseek-v4-flash#max` 时，OpenCode 因模型变体无法解析而退出，worker 没有进入可提示状态。只有裸模型 `opencode-go/deepseek-v4-flash` 能启动，因此绕行会失去 low/max 档位固定。",
  "memoryRelations": []
}
---
---
title: 'DeepSeek V4 Flash 的 #low/#max 预设无法启动'
severity: 'minor'
---

## Expected Behavior

AGENTS.md 中的 `flash-low-researcher` 与 `flash-max-worker` 预设可以直接启动，并固定对应 effort。

## Current Behavior

使用 `opencode-go/deepseek-v4-flash#low` 或 `opencode-go/deepseek-v4-flash#max` 时，OpenCode 因模型变体无法解析而退出，worker 没有进入可提示状态。只有裸模型 `opencode-go/deepseek-v4-flash` 能启动，因此绕行会失去 low/max 档位固定。

## Possible Solution

校准 provider 实际支持的模型引用，或更新两个预设与就绪检查，让无效变体在创建 worker 前给出明确错误。

## Minimal Reproducible Example

```sh
herdr agent start audit --kind opencode --pane PANE_ID --timeout 120000 -- \
  --mini --model opencode-go/deepseek-v4-flash#low --auto
```

把 `#low` 改成 `#max` 结果相同。

## Context

父 agent 必须识别失败 pane、读取现场、关闭 pane，再用裸模型重启。该问题在同一任务中用 low 与 max 各复现一次。
