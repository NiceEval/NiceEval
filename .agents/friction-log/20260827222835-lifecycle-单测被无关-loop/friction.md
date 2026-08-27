---
title: 'lifecycle 单测被无关 loop quota preflight 整仓阻断'
severity: 'major'
---

## Actual observation

`pnpm e2e test --repo lifecycle -- --run test/incus-user-database-ledger.test.ts` 在运行测试前要求 `linux-loop-project-quota`，目标 fake-Incus 测试 0 次执行。

## Expected behavior

按测试文件选择 capability；fake-Incus 测试不继承其它场景的 loop quota preflight。

## Impact

正式 installed-candidate E2E 入口无法单独验证 Incus ledger。

## Public entry-point reproduction

`pnpm e2e test --repo lifecycle -- --run test/incus-user-database-ledger.test.ts --keep-workdir`

## NiceEval identity

main candidate 0.4.6

## Environment

Linux, Node v24.19.0, pnpm 11.12.0；Docker 可用，loop quota capability 不可用。

## Source provenance

NiceEval main 的根目录正式 e2e runner；receipt 显示 `testInvocations: 0`。

## Public data confirmation

- [x] I removed secrets, credentials, private customer data, private repository content, and other sensitive material from this issue.
- [x] This issue does not disclose or describe a suspected security vulnerability.
