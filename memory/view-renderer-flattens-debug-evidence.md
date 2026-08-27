---
format: niceeval.memory/v1
id: view-renderer-flattens-debug-evidence
title: 固定 View renderer 把 Attempt 调试证据压平为摘要表格
createdAt: 2026-08-26T15:44:35+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "Installed-package browser red: candidate SHA-256 832ee8c95911bf05c415d9dbb1458b804744ce082a1c8756007833fe0d4c621e failed the canonical report Journey at the earliest Grid observation; artifacts/e2e/attempt-detail-red-confirmed/summary.json reports a regression because the first two usage cells both had x=110."
      - "Installed-package browser green: candidate SHA-256 62e9558e8054ed6f369d90d3d4dcc43e587e0ea8a7a0375a40d57f8fbfa345dd passed e2e/report/test/view-snapshot.browser.spec.ts through the public niceeval view entry; artifacts/e2e/attempt-detail-green-confirmed/summary.json reports a clean pass for responsive usage Grid cells, the t.send(...) inline Session log, and structured assertion Observed fields."
      - "Reliability takeover: artifacts/e2e/attempt-detail-takeover/takeover-summary.json reports all required observations passed for the same candidate, including three isolated copies, two consecutive runs in one installed copy, the report Repo default-parallel suite (5 query tests and 3 Chromium Journeys), the target file/title run, and clean resource cleanup."
promotions:
  - kind: use-case
    current:
      - docs/feature/insight/use-case/审阅一次Run怎样采用结果.md
    history:
      - target: docs/feature/reports/use-case/审阅一次Run怎样采用结果.md
        commit: f8eb3968044213605bc2042944777d12afd13eb9
---
# 固定 View renderer 把 Attempt 调试证据压平为摘要表格

## 问题

SQLite Record 与固定 Inspection 切换后，`niceeval view @<attempt-locator>` 只把 Attempt 的基本结果、断言摘要和三列 trace 表格放在主页。源码被拆到独立页，tool call 不显示输入，Turn、timing、usage、commands 与 diagnostics 没有可用的调试表达。读者无法从断言位置追到对话与工具证据，View 因而失去调试用途。

## 根因

新 `ViewRevision` 已在生成期执行 `attempt.get`、`attempt.trace`、`attempt.diff`、`attempt.sources` 与 `attempt.artifacts`，因此缺失不是 SQLite 读取或 Inspection 投影失败。固定 renderer 只消费了 `trace.conversation.items` 中的 `kind`、actor 和一个 result 值，完全忽略 conversation turns/context、tool occurrence 输入与配对输出、usage、timing、commands 和 diagnostics。

同一 renderer 把 `attempt.sources` 与 assertion source sites 放进独立的通用文本表格，没有在 Attempt 中按源码行组织断言证据。这是 Delivery 展示层的语义丢失，不需要改变 Record 或开放自定义组件与服务。

## 修复边界

保留固定的第一方 View 和现有 Inspection operations。Attempt 页恢复一体化调试工作台：源码与断言位置、可搜索和折叠的 session log、exact tool occurrence 的输入与输出、trajectory/timing、usage、commands、diagnostics 与 diff。每个区域仍保留 Inspection 已关闭的 partial、missing、invalid 和 truncated 状态。

## 修复落点

- `packages/niceeval/src/view/render.ts` 恢复 Attempt 一体化调试页面。
- `packages/niceeval/src/view/cli/contribution.ts` 收窄为 options-only 启动与页内导航。
- `e2e/report/test/view-snapshot.browser.spec.ts`、`e2e/report/test/view-lifecycle.test.ts` 与 `e2e/report/test/view-authorization.browser.spec.ts` 分别接管浏览器审阅、CLI/lifecycle 与 loopback authorization 结果。

## 回归证据

安装后当前候选经真实 `exp → record snapshot → view --record → Chromium` 在现有 `view-snapshot.browser.spec.ts` 中取得红灯。最早公开失败是 Attempt 页缺少 `Source & assertions` heading；收据为 `/tmp/niceeval-e2e-artifacts-iVIVdK/summary.json`，保留场景为 `/tmp/niceeval-e2e-scratch-4SSSTG`。

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `71cdcb87bb3805422d1c7f5afd6c3575046fe302`

```json
{
  "kind": "fixed",
  "proof": [
    "Installed-package browser red: /tmp/niceeval-e2e-artifacts-iVIVdK/summary.json reports report E2E regression (0/1 passed); canonical owner e2e/report/test/view-snapshot.browser.spec.ts failed at the earliest public browser observation because the Attempt page had no visible Source & assertions heading.",
    "Installed-package CLI red: /tmp/niceeval-e2e-view-cli-red-P2xTKO/summary.json reports report E2E regression (0/1 passed); view-lifecycle.test.ts observed that niceeval view --help still advertised @<attempt-locator> instead of the options-only usage.",
    "Same final candidate /tmp/niceeval-view-final.2d8GGS/candidate/niceeval-view-final.tgz (SHA-256 713a24676410964694fd382dc8261b02ffdfa87223fa676cddbac8b11830e2ae) passed browser, lifecycle, and authorization E2E cleanly: /tmp/niceeval-view-final.2d8GGS/browser/summary.json, /tmp/niceeval-view-final.2d8GGS/lifecycle/summary.json, and /tmp/niceeval-view-final.2d8GGS/authorization/summary.json each report 1/1 passed.",
    "Takeover /tmp/niceeval-view-final.2d8GGS/takeover/takeover-summary.json reports all six required matrices cleanly passed for that candidate: isolated-copy-1, isolated-copy-2, isolated-copy-3, same-copy with two consecutive test invocations, repo-default-parallel, and target-single; matrixValidation is complete, noRetry is true, every run cleanup is true, and source snapshot cleanup succeeded."
  ]
}
```

### Reopened at `71cdcb87bb3805422d1c7f5afd6c3575046fe302`

```json
{
  "kind": "fixed",
  "proof": [
    "Installed-package browser red: /tmp/niceeval-e2e-artifacts-iVIVdK/summary.json reports report E2E regression (0/1 passed); the canonical owner e2e/report/test/view-snapshot.browser.spec.ts failed at the earliest public browser observation because the Attempt page had no visible Source & assertions heading.",
    "The user-visible PR Preview still exposed a non-expandable experiment table and a flattened Attempt view; the restored owner now observes the Experiment → optional Eval path group → Eval → Attempt hierarchy, pass/points/mixed metrics, overlay navigation, Assertion matcher details, conversation anchors, Trajectory, usage, commands, diagnostics, and diff through the installed browser entry.",
    "Same final candidate /tmp/niceeval-view-plain-modal-candidate.JD5GYP/niceeval-view-plain-modal-candidate.tgz (SHA-256 4c1f9143d9824f5f50a3edff36eb7542f5a970ae7413dc8c60df312d10ad5dcf) passed authorization, operational refresh, and snapshot Chromium owners: /tmp/niceeval-view-plain-modal-green-4c1f9143.rBnclp/summary.json reports a clean 3/3 browser pass with no CSP console errors.",
    "The same candidate passed the complete report takeover without rebuild or repack: /tmp/niceeval-view-report-takeover-4c1f9143.nv5syC/summary.json reports a clean pass for 5 machine-query tests and all 3 Chromium journeys."
  ]
}
```

### Reopened at `8085191c5aa9ec59154bd7415fc5ba541a705b45`

```json
{
  "kind": "fixed",
  "proof": [
    "Installed-package browser red: /tmp/niceeval-e2e-artifacts-iVIVdK/summary.json reports report E2E regression (0/1 passed); the canonical owner e2e/report/test/view-snapshot.browser.spec.ts failed at the earliest public browser observation because the Attempt page had no visible Source & assertions heading.",
    "The user-visible PR Preview still exposed a non-expandable experiment table and a flattened Attempt view; the restored owner now observes the Experiment → optional Eval path group → Eval → Attempt hierarchy, pass/points/mixed metrics, overlay navigation, Assertion matcher details, conversation anchors, Trajectory, usage, commands, diagnostics, and diff through the installed browser entry.",
    "Final package candidate /tmp/niceeval-view-final-no-radix-candidate.xJI7Y8/niceeval-view-final-no-radix-candidate.tgz (SHA-256 4cc9b29227aebf115239e42a8e1d9c9d394b46603c4c7d084ef17ee8a7820d54) passed the complete report takeover without rebuild or repack: /tmp/niceeval-view-final-takeover-4cc9b292.wq9cJ2/summary.json reports 5 machine-query tests and all 3 Chromium journeys cleanly passed, including authorization, operational refresh, complete Attempt debugging, and an empty CSP console error collection."
  ]
}
```

### Reopened at `8085191c5aa9ec59154bd7415fc5ba541a705b45`

```json
{
  "kind": "fixed",
  "proof": [
    "Installed-package browser red: candidate SHA-256 832ee8c95911bf05c415d9dbb1458b804744ce082a1c8756007833fe0d4c621e failed the canonical report Journey at the earliest Grid observation; artifacts/e2e/attempt-detail-red-confirmed/summary.json reports a regression because the first two usage cells both had x=110.",
    "Installed-package browser green: candidate SHA-256 62e9558e8054ed6f369d90d3d4dcc43e587e0ea8a7a0375a40d57f8fbfa345dd passed e2e/report/test/view-snapshot.browser.spec.ts through the public niceeval view entry; artifacts/e2e/attempt-detail-green-confirmed/summary.json reports a clean pass for responsive usage Grid cells, the t.send(...) inline Session log, and structured assertion Observed fields.",
    "Reliability takeover: artifacts/e2e/attempt-detail-takeover/summary.json reports all required observations passed for the same candidate, including three isolated copies, two consecutive runs in one installed copy, the report Repo default-parallel suite (5 query tests and 3 Chromium Journeys), the target file/title run, and clean resource cleanup."
  ]
}
```
