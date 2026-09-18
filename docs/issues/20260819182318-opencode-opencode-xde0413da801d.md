---
format: concord.document/v1
id: 20260819182318-opencode-opencode-xde0413da801d
title: OpenCode 不识别规则固定的 opencode-go/MiMo-V2.5
createdAt: 2026-08-19T18:23:18+08:00
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
subject: dependency
claim: friction
observation: |
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
impact: "herdr agent start 能启动 pane，但提交 prompt 后 OpenCode 立即返回 ProviderModelNotFoundError: Model not found: opencode-go/MiMo-V2.5，并只建议 mimo-v2.5 或 mimo-v2.5-pro。仓库路由规则禁止擅自改用其它 OpenCode model id，因此 worker 无法执行。"
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/20260819182318-opencode-不识别规则固定的-opencode/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:91cbbccee917c5bad695f0c1a24464422ceb3456d9c28564bffbb8ac1e3f19f5
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
