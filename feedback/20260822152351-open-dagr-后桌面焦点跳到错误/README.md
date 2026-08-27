---
format: niceeval.feedback/v2
id: 20260822152351-open-dagr-后桌面焦点跳到错误
title: open-dagr 后桌面焦点跳到错误 workspace
state: open
reportedAt: 2026-08-22T15:23:51+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
subject: dependency
claim: friction
observation: |
  ---
  title: 'open-dagr 后桌面焦点跳到错误 workspace'
  severity: 'minor'
  ---

  ## Expected Behavior

  在 Herdr 管理的父 pane 中执行 `herdr plugin action invoke open-dagr --plugin herdr-dagr` 后，Dagr 应在当前 workspace 打开，并保持父 pane 可见；若动作要切焦点，也只能切到同一 workspace 的 Dagr pane。

  ## Current Behavior

  Dagr pane 确实创建在当前 workspace，但桌面焦点跳到了另一个 workspace。父 agent 仍在原 pane 工作，用户看到的却不是当前任务；需要额外执行 `herdr agent focus w27:p1` 才恢复。

  ## Possible Solution

  plugin action 应把调用者 workspace/pane 作为显式焦点目标，完成布局后原子恢复父 pane，或返回新 Dagr pane 让调用者自行选择是否 focus。

  ## Minimal Reproducible Example

  1. 在 Herdr workspace 的 Codex 父 pane 中记录 `HERDR_WORKSPACE_ID` 与 `HERDR_PANE_ID`。
  2. 执行 `herdr plugin action invoke open-dagr --plugin herdr-dagr`。
  3. 观察 Dagr pane 出现在原 workspace，但桌面当前焦点落到其它 workspace。
  4. 执行 `herdr agent focus <原父 pane id>` 后恢复。

  ## Context

  多 worker CLI 重构期间按用户要求打开 Dagr 时复现。Dagr 数据与 pane 本身可用，问题只在跨 workspace 的可见焦点，容易让用户误以为主 agent 已停住。
impact: Dagr pane 确实创建在当前 workspace，但桌面焦点跳到了另一个 workspace。父 agent 仍在原 pane 工作，用户看到的却不是当前任务；需要额外执行 `herdr agent focus w27:p1` 才恢复。
memoryRelations: []
adoptions:
  current: []
  history: []
---
---
title: 'open-dagr 后桌面焦点跳到错误 workspace'
severity: 'minor'
---

## Expected Behavior

在 Herdr 管理的父 pane 中执行 `herdr plugin action invoke open-dagr --plugin herdr-dagr` 后，Dagr 应在当前 workspace 打开，并保持父 pane 可见；若动作要切焦点，也只能切到同一 workspace 的 Dagr pane。

## Current Behavior

Dagr pane 确实创建在当前 workspace，但桌面焦点跳到了另一个 workspace。父 agent 仍在原 pane 工作，用户看到的却不是当前任务；需要额外执行 `herdr agent focus w27:p1` 才恢复。

## Possible Solution

plugin action 应把调用者 workspace/pane 作为显式焦点目标，完成布局后原子恢复父 pane，或返回新 Dagr pane 让调用者自行选择是否 focus。

## Minimal Reproducible Example

1. 在 Herdr workspace 的 Codex 父 pane 中记录 `HERDR_WORKSPACE_ID` 与 `HERDR_PANE_ID`。
2. 执行 `herdr plugin action invoke open-dagr --plugin herdr-dagr`。
3. 观察 Dagr pane 出现在原 workspace，但桌面当前焦点落到其它 workspace。
4. 执行 `herdr agent focus <原父 pane id>` 后恢复。

## Context

多 worker CLI 重构期间按用户要求打开 Dagr 时复现。Dagr 数据与 pane 本身可用，问题只在跨 workspace 的可见焦点，容易让用户误以为主 agent 已停住。
