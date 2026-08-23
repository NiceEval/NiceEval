---
{
  "format": "niceeval.feedback/v1",
  "id": "20260819182318-opencode-不识别规则固定的-opencode",
  "title": "OpenCode 不识别规则固定的 opencode-go/MiMo-V2.5",
  "state": "open",
  "reportedAt": "2026-08-19T18:23:18+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "dependency",
  "claim": "friction",
  "observation": "---\ntitle: 'OpenCode 不识别规则固定的 opencode-go/MiMo-V2.5'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n按 AGENTS.md 创建的 mimo-max-worker 使用 pane-local OPENCODE_CONFIG_CONTENT 指定 opencode-go/MiMo-V2.5 与 variant=max 后，应由 OpenCode build agent 正常接受任务。\n\n## Current Behavior\n\nherdr agent start 能启动 pane，但提交 prompt 后 OpenCode 立即返回 ProviderModelNotFoundError: Model not found: opencode-go/MiMo-V2.5，并只建议 mimo-v2.5 或 mimo-v2.5-pro。仓库路由规则禁止擅自改用其它 OpenCode model id，因此 worker 无法执行。\n\n## Possible Solution\n\n统一 Herdr/OpenCode provider 暴露的 model id 与 AGENTS.md 固定路由，或让 OpenCode 对 opencode-go/MiMo-V2.5 提供稳定 alias；启动时也可在接受 prompt 前验证 pane-local model 是否可解析。\n\n## Minimal Reproducible Example\n\n创建带 OPENCODE_CONFIG_CONTENT 的 pane，其中 build model 为 opencode-go/MiMo-V2.5、variant 为 max，然后运行 opencode --mini --agent build --auto 并提交任意 prompt。OpenCode 立即报上述 ProviderModelNotFoundError。\n\n## Context\n\n2026-08-19 在 Herdr workspace w1Q 的 report-test-finish worker 稳定复现；同一 pane 的权限配置已按仓库模板设置。\n",
  "impact": "herdr agent start 能启动 pane，但提交 prompt 后 OpenCode 立即返回 ProviderModelNotFoundError: Model not found: opencode-go/MiMo-V2.5，并只建议 mimo-v2.5 或 mimo-v2.5-pro。仓库路由规则禁止擅自改用其它 OpenCode model id，因此 worker 无法执行。",
  "memoryRelations": []
}
---
---
title: 'OpenCode 不识别规则固定的 opencode-go/MiMo-V2.5'
severity: 'minor'
---

## Expected Behavior

按 AGENTS.md 创建的 mimo-max-worker 使用 pane-local OPENCODE_CONFIG_CONTENT 指定 opencode-go/MiMo-V2.5 与 variant=max 后，应由 OpenCode build agent 正常接受任务。

## Current Behavior

herdr agent start 能启动 pane，但提交 prompt 后 OpenCode 立即返回 ProviderModelNotFoundError: Model not found: opencode-go/MiMo-V2.5，并只建议 mimo-v2.5 或 mimo-v2.5-pro。仓库路由规则禁止擅自改用其它 OpenCode model id，因此 worker 无法执行。

## Possible Solution

统一 Herdr/OpenCode provider 暴露的 model id 与 AGENTS.md 固定路由，或让 OpenCode 对 opencode-go/MiMo-V2.5 提供稳定 alias；启动时也可在接受 prompt 前验证 pane-local model 是否可解析。

## Minimal Reproducible Example

创建带 OPENCODE_CONFIG_CONTENT 的 pane，其中 build model 为 opencode-go/MiMo-V2.5、variant 为 max，然后运行 opencode --mini --agent build --auto 并提交任意 prompt。OpenCode 立即报上述 ProviderModelNotFoundError。

## Context

2026-08-19 在 Herdr workspace w1Q 的 report-test-finish worker 稳定复现；同一 pane 的权限配置已按仓库模板设置。
