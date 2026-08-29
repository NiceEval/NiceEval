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

`niceeval show` 的默认 Overview 按 `Experiment ID + Eval ID + attempt ordinal` 选择 Record 中最新的 sealed Slot。当前 Eval、Experiment 或 Sandbox 配置改变并产生新的 execution identity 后，旧 Attempt 仍会显示成当前结果。

这会让用户误以为已经退役或尚未采用的结果仍适用于当前项目。历史 Run 和 Attempt 应继续支持 exact 下钻，但不应在当前结果 Overview 中冒充当前 target。

## Root cause

Inspection Overview 只从 Record facts 选择每个逻辑位置的最新 occurrence，没有用当前项目计划生成的 `executionIdentityDigest` 限定 slot。现有 Show E2E 只验证刚产出的当前结果，Accept E2E 只验证 reference Member，没有覆盖 identity 改变后的默认可见性。

## Expected resolution

安装后的公开 CLI 应证明：结果初次运行后可见；改变 Eval identity 后旧结果从默认 `niceeval show` 消失；执行 `niceeval accept @<locator>` 后，accepted reference Member 以当前 target identity 再次进入默认 Overview。`--run` 和 Attempt locator 仍可精确读取历史事实。

## Resolution history

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
