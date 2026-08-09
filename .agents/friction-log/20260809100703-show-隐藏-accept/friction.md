---
title: 'show 隐藏 accept 新条目与 acceptedFrom 审计'
severity: 'minor'
---

## Expected Behavior

执行 `niceeval accept @<old-locator>` 后，公开的 `niceeval show --history` 或 `niceeval show @<new-locator>` 能显示新条目的 `acceptedFrom`：旧 locator、旧/新 fingerprint 与差异摘要，用户无需改用库 API 才能审计人工接受。

## Current Behavior

accept 成功创建新 locator，后续 dry/exp 也会 carry；`niceeval/record` 的 `openRecord()` + `resolveLocator()` 能读到完整 `acceptedFrom`。但 `show --history` 以 `experimentId|evalId|attempt|startedAt` 去重，accept 新条目复制来源 `startedAt` 后与旧条目碰撞，新条目整行消失；`show @<new-locator>` 的 attempt 视图也不投影 `acceptedFrom`。

## Possible Solution

让 history 身份保留 accept 产生的新 locator，或在去重时合并/展示 provenance；同时在 locator attempt task Result 中公开 `acceptedFrom`，使 text/JSON 两面都能审计人工重锚。

## Minimal Reproducible Example

在一个 Eval 完整跑出 passed 结果后修改其源码，运行 `niceeval accept @<old-locator>`。随后：
1. `niceeval show <eval-id> --history --json` 只含旧 locator；
2. `niceeval show @<new-locator> --json` 的 data 不含 `acceptedFrom`；
3. 同一 results root 用 `niceeval/record` 解码新 locator，`result.acceptedFrom` 完整存在。

对应稳定复现 Journey：`e2e/runner/test/accept-reanchor.test.ts`。

## Context

重构 Runner accept/dry E2E 时，为保留审计断言只能从 show 切到公开 Record API。测试仍覆盖产品数据，但 CLI 用户的事后诊断链不完整。
