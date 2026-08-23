---
{
  "format": "niceeval.feedback/v1",
  "id": "20260810093352-grill-me-技能引用的",
  "title": "grill-me 技能引用的 /grilling 在 Codex CLI 不存在",
  "state": "open",
  "reportedAt": "2026-08-10T09:33:52+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'grill-me 技能引用的 /grilling 在 Codex CLI 不存在'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\ngrill-me 技能要求运行 /grilling session 时，Herdr 中的 Codex worker 能识别该入口并开始交互式设计挑战。\n\n## Current Behavior\n\ngpt-5.6-sol worker 完整读取 grill-me/SKILL.md 后输入 /grilling，Codex CLI 返回未知 slash command。worker 只能由父 agent 提供等价的逐轮质询 prompt，技能正文没有给出 fallback。\n\n## Possible Solution\n\n让当前 Codex CLI 提供 /grilling，或把 grill-me/SKILL.md 改成当前可执行的明确 prompt 流程，并写清没有 slash command 时的 fallback。\n\n## Minimal Reproducible Example\n\n1. 通过 Herdr 启动 Codex worker。\n2. 让 worker 完整读取 .agents/skills/grill-me/SKILL.md。\n3. 按技能正文运行 /grilling。\n4. Codex CLI 报告未知 slash command，没有启动 grilling session。\n\n## Context\n\n本次重大 Record 契约设计必须通过 grill-me。为了不跳过设计门禁，父 agent 只能显式下发等价质询流程，增加了技能解释分歧。\n",
  "impact": "gpt-5.6-sol worker 完整读取 grill-me/SKILL.md 后输入 /grilling，Codex CLI 返回未知 slash command。worker 只能由父 agent 提供等价的逐轮质询 prompt，技能正文没有给出 fallback。",
  "memoryRelations": []
}
---
---
title: 'grill-me 技能引用的 /grilling 在 Codex CLI 不存在'
severity: 'minor'
---

## Expected Behavior

grill-me 技能要求运行 /grilling session 时，Herdr 中的 Codex worker 能识别该入口并开始交互式设计挑战。

## Current Behavior

gpt-5.6-sol worker 完整读取 grill-me/SKILL.md 后输入 /grilling，Codex CLI 返回未知 slash command。worker 只能由父 agent 提供等价的逐轮质询 prompt，技能正文没有给出 fallback。

## Possible Solution

让当前 Codex CLI 提供 /grilling，或把 grill-me/SKILL.md 改成当前可执行的明确 prompt 流程，并写清没有 slash command 时的 fallback。

## Minimal Reproducible Example

1. 通过 Herdr 启动 Codex worker。
2. 让 worker 完整读取 .agents/skills/grill-me/SKILL.md。
3. 按技能正文运行 /grilling。
4. Codex CLI 报告未知 slash command，没有启动 grilling session。

## Context

本次重大 Record 契约设计必须通过 grill-me。为了不跳过设计门禁，父 agent 只能显式下发等价质询流程，增加了技能解释分歧。
