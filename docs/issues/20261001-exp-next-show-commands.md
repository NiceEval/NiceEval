---
format: concord.document/v1
id: 20261001-exp-next-show-commands
title: exp 结束反馈的下一步只指向浏览器 view，没有终端 show 命令
createdAt: 2026-10-01T02:45:52.982Z
kind: issue
state: closed
memoryRelations: []
adoptions:
  current: []
  history: []
closure:
  kind: closed
  reason: 已修复：9cdc24913。失败条目给出 niceeval show @<locator>，NEXT 并列 show 与 view。沙箱外 E2E：cli failure-error-results 与 provider-error-feedback 5/5、runner accept-reanchor 1/1 通过。
history:
  - at: 2026-10-01T04:19:58.788Z
    action: close
    reason: 已修复：9cdc24913。失败条目给出 niceeval show @<locator>，NEXT 并列 show 与 view。沙箱外 E2E：cli failure-error-results 与 provider-error-feedback 5/5、runner accept-reanchor 1/1 通过。
---

## 观察

`niceeval exp` 结束后，终端给出的下一步都指向浏览器：

- `FAILURES` 面板里每个失败 Attempt 下面是一行固定的 `details: niceeval view`，不带 Run 或 locator（`packages/niceeval/src/runner/feedback/human.ts` 的 `buildSingleFailureGroupRows`）。
- `NEXT` 面板只给 `niceeval view --run <run-id>`。

失败行里已经有 Attempt locator，但没有对应的 `niceeval show @<locator>`。

## 期望

用户在终端里看到失败时，下一步命令能直接留在终端：每个失败 Attempt 给出可复制的 `niceeval show @<locator>`，`NEXT` 同时给出 `niceeval show --run <run-id>` 和 `niceeval view --run <run-id>`。`docs/feature/experiments/cli.md`「结束反馈与 receipt」目前规定的是 `details: niceeval view --run <runId>`，需要一起修订。

## 影响

CI 日志、SSH 会话和 Coding Agent 都没有浏览器。它们拿到失败后，要么自己拼 `show @<locator>`，要么去打开一个用不了的页面。`details: niceeval view` 不带任何选择，打开后还要人工找到这个 Attempt。

## 复现

运行任意一个会失败的 Experiment，查看结束面板的 `FAILURES` 与 `NEXT`。

## 来源

Agent 辅助的直接使用：重写中文快速开始与查看结果页面时，对照 `human.ts` 的面板构造发现。HEAD `a12be6534`。
