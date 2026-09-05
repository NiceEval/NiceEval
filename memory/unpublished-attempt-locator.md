---
format: niceeval.memory/v1
id: unpublished-attempt-locator
title: Failed Attempt persistence exposed an unqueryable locator
createdAt: 2026-08-30
kind:
  type: problem
  state: open
promotions: []
---
## Observation

When final Attempt persistence fails after reservation, `niceeval exp --json` prints the reserved `@...` locator even though no published Attempt is available through `niceeval query run` or `niceeval show`.

Formal public-entry red evidence: `nered_W2VKAM0W4M5JQHNX` for `e2e/runner/test/timing.test.ts#necase_EP0HS2HD783EN64J`.

## Root cause

The Runner copied the reservation locator into `EvalResult` before `completeAttemptOrMarkIncomplete` succeeded. The Record coordinator intentionally converted the completion write error into an incomplete result and retained it for invocation publication failure, but the feedback path still treated the provisional locator as public and emitted a permanent failure event.

## Required behavior

Only a successfully persisted Attempt may contribute a public locator. A completion write failure must keep the invocation failed, omit an inspectable locator, and render an explicit persistence/publication diagnostic instead of `[object Object]`.

## 2026-09-05 证据审计

原 selector e2e/runner/test/timing.test.ts#necase_EP0HS2HD783EN64J 现在证明 Run close 失败后已经发布的 Attempt 仍可查询，与未发布 locator 的命题不同。本轮已 managed reopen 并 retire 该错误 regression，保留历史。现有 e2e/runner/test/attempt-publication-failure.test.ts#necase_MJKBRQFQP8P4EWH5 区分 publication diagnostic 中的保留 identity 与可查询结果，但仍需针对本 Problem 的公开结果建立当前证据，不能直接移用旧 timing 凭据。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_W2VKAM0W4M5JQHNX",
    "netake_GJJA4SEJARRRNT6W",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/runner/test/timing.test.ts#necase_EP0HS2HD783EN64J\"]}"
  ]
}
```
