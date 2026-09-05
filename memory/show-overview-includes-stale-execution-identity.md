---
format: niceeval.memory/v1
id: show-overview-includes-stale-execution-identity
title: Show Overview includes stale execution identity
createdAt: 2026-08-28
kind:
  type: problem
  state: open
promotions: []
---
## Problem

`niceeval show` 的默认 Overview 在打开 canonical Record 后，又用当前项目计划的 `executionIdentityDigest` 过滤 sealed Slot。只要当前源码或物化候选 identity 变化，Record 中仍存在的结果就会从人读 Overview 消失，并显示成 `Observed 0/0`。

这破坏了 `show` 作为 Record Overview 的读取职责。用户不能从默认终端入口看到已经发布的最新结果，只能预先知道 Run ID 后逐个下钻，或改用 machine `overview.get`。

## Root cause

2026-08-28 的 stale-result 修复把“结果是否可查看”和“结果能否为当前 target 复用”合并成同一个 identity gate。Experiment planning 的 reuse eligibility 被下沉到 Inspection selection，导致 operational `show` 与 query/View 对同一 canonical Record 得到不同的默认 Overview。

## Expected resolution

安装后的公开 CLI 应证明：一次 Run 封口后，无参数 `niceeval show` 显示该结果；改变 Eval、Experiment、Sandbox 或物化候选 identity 后，同一 sealed result 仍留在默认 Overview，且不会退化为 `Observed 0/0`。`exp --dry` 仍独立报告 `identity-mismatch`，只有 reuse 或 adoption 需要满足当前 target identity。

`--run` 和 Attempt locator 继续提供 exact 下钻。默认 Overview 按 `experimentId + evalId + attemptOrdinal` 选择 canonical Record 中每个逻辑 Slot 的最新 sealed occurrence。

## 2026-09-05 证据审计

历史证明绑定的源码已变化，且原有身份变化检查只调用 show --all。本轮补充默认 niceeval show 在 execution identity 变化后仍输出 canary 1/1 的公开断言。已 managed reopen；旧 receipts 不再证明当前测试，需重新取得对应身份错误的红灯与接管。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `c8c394dfdfc89c95392c842a7ccccbdc0f9358bb`

```json
{
  "kind": "fixed",
  "proof": [
    "red: pnpm e2e test --repo report --keep-workdir -- --run test/show-cli.test.ts failed because stale Overview still contained the changed Eval locator",
    "green: pnpm e2e test --repo report -- --run test/show-cli.test.ts passed in three isolated runs",
    "takeover: pnpm e2e test --repo report passed 6 Vitest tests and 3 Playwright tests with cleanup"
  ]
}
```

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_JD97KAZABC4G7GCT",
    "netake_T7KP4ABHNZN939NR",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS\"]}"
  ]
}
```
