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
      - "Installed-package browser red: /tmp/niceeval-e2e-artifacts-iVIVdK/summary.json reports report E2E regression (0/1 passed); canonical owner e2e/report/test/view-snapshot.browser.spec.ts failed at the earliest public browser observation because the Attempt page had no visible Source & assertions heading."
      - "Installed-package CLI red: /tmp/niceeval-e2e-view-cli-red-P2xTKO/summary.json reports report E2E regression (0/1 passed); view-lifecycle.test.ts observed that niceeval view --help still advertised @<attempt-locator> instead of the options-only usage."
      - "Same final candidate /tmp/niceeval-view-final.2d8GGS/candidate/niceeval-view-final.tgz (SHA-256 713a24676410964694fd382dc8261b02ffdfa87223fa676cddbac8b11830e2ae) passed browser, lifecycle, and authorization E2E cleanly: /tmp/niceeval-view-final.2d8GGS/browser/summary.json, /tmp/niceeval-view-final.2d8GGS/lifecycle/summary.json, and /tmp/niceeval-view-final.2d8GGS/authorization/summary.json each report 1/1 passed."
      - "Takeover /tmp/niceeval-view-final.2d8GGS/takeover/takeover-summary.json reports all six required matrices cleanly passed for that candidate: isolated-copy-1, isolated-copy-2, isolated-copy-3, same-copy with two consecutive test invocations, repo-default-parallel, and target-single; matrixValidation is complete, noRetry is true, every run cleanup is true, and source snapshot cleanup succeeded."
promotions:
  - kind: use-case
    current:
      - docs/feature/reports/use-case/审阅一次Run怎样采用结果.md
    history: []
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
