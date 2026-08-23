---
{
  "format": "niceeval.feedback/v1",
  "id": "20260809164436-codex-速率选择器会吞掉-herdr",
  "title": "Codex 速率选择器会吞掉 Herdr agent prompt 并静默切换模型",
  "state": "open",
  "reportedAt": "2026-08-09T16:44:36+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'Codex 速率选择器会吞掉 Herdr agent prompt 并静默切换模型'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\nHerdr 对已经停稳的 Codex worker 调用 `herdr agent prompt <worker> <task>` 时，新任务应原子提交给 agent；若终端被速率提示或其它选择器占用，应返回明确错误，且固定模型的 worker 不应被静默改成另一模型。\n\n## Current Behavior\n\n`gpt-5.6-sol` design_grill 完成一轮后停在 Codex 的速率提示选择器。父 agent 调用 `herdr agent prompt` 返回成功，但文本没有成为新任务；选择器反而选中推荐项，把 pane 切换为 `gpt-5.6-luna`。Herdr 仍报告 prompt 成功与 agent done，只有读取 pane 才能发现任务未执行和模型已改变。\n\n## Possible Solution\n\nHerdr 在提交 prompt 前识别 Codex modal/choice 状态并拒绝，或先显式关闭选择器再原子提交；同时校验运行中模型仍符合 `agent start` 的固定模型参数，发生变化时返回可观察的 routing error。\n\n## Minimal Reproducible Example\n\n1. 以 `herdr agent start grill --kind codex --pane <pane> -- -m gpt-5.6-sol -c model_reasoning_effort=max -s read-only -a never` 启动 worker。\n2. 让 worker 运行至 Codex 显示速率限制模型选择器并停稳。\n3. 执行 `herdr agent prompt grill 继续只读复审`。\n4. 命令返回 prompted，但 `herdr agent read grill` 看不到新任务，底部模型从 Sol 变为 Luna。\n\n## Context\n\n重大设计挑战硬性要求独立 Sol/max。该静默切换会让父 agent 误把未执行或错误模型的结果当成正式验收，因此本轮只能关闭旧 pane 并重新启动全新 Sol worker。\n",
  "impact": "`gpt-5.6-sol` design_grill 完成一轮后停在 Codex 的速率提示选择器。父 agent 调用 `herdr agent prompt` 返回成功，但文本没有成为新任务；选择器反而选中推荐项，把 pane 切换为 `gpt-5.6-luna`。Herdr 仍报告 prompt 成功与 agent done，只有读取 pane 才能发现任务未执行和模型已改变。",
  "memoryRelations": []
}
---
---
title: 'Codex 速率选择器会吞掉 Herdr agent prompt 并静默切换模型'
severity: 'minor'
---

## Expected Behavior

Herdr 对已经停稳的 Codex worker 调用 `herdr agent prompt <worker> <task>` 时，新任务应原子提交给 agent；若终端被速率提示或其它选择器占用，应返回明确错误，且固定模型的 worker 不应被静默改成另一模型。

## Current Behavior

`gpt-5.6-sol` design_grill 完成一轮后停在 Codex 的速率提示选择器。父 agent 调用 `herdr agent prompt` 返回成功，但文本没有成为新任务；选择器反而选中推荐项，把 pane 切换为 `gpt-5.6-luna`。Herdr 仍报告 prompt 成功与 agent done，只有读取 pane 才能发现任务未执行和模型已改变。

## Possible Solution

Herdr 在提交 prompt 前识别 Codex modal/choice 状态并拒绝，或先显式关闭选择器再原子提交；同时校验运行中模型仍符合 `agent start` 的固定模型参数，发生变化时返回可观察的 routing error。

## Minimal Reproducible Example

1. 以 `herdr agent start grill --kind codex --pane <pane> -- -m gpt-5.6-sol -c model_reasoning_effort=max -s read-only -a never` 启动 worker。
2. 让 worker 运行至 Codex 显示速率限制模型选择器并停稳。
3. 执行 `herdr agent prompt grill 继续只读复审`。
4. 命令返回 prompted，但 `herdr agent read grill` 看不到新任务，底部模型从 Sol 变为 Luna。

## Context

重大设计挑战硬性要求独立 Sol/max。该静默切换会让父 agent 误把未执行或错误模型的结果当成正式验收，因此本轮只能关闭旧 pane 并重新启动全新 Sol worker。
