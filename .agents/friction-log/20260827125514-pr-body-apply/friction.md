---
title: 'pr:body apply 改写测试源码中的反斜线 Unicode escape'
severity: 'minor'
---

## Actual observation

测试源码包含字面 `\u001b` 时，远端正文被改写为 `\^[[`；`apply` 返回成功，但每次 remote check 都报告正文 stale。

## Expected behavior

`pnpm pr:body apply --pr <number>` 应保留渲染正文里的测试源码字节，随后 remote check 应通过。

## Impact

受管 PR 创建会在远端 mutation 已发生后返回失败，重复 apply 也无法完成规定的远端验收；作者必须改写等价测试源码才能继续。

## Public entry-point reproduction

在 test directive 展开的源码中保留 `expect(raw).toContain("\u001b[31m")`，运行 `pnpm pr:body apply --pr <number>`，再比较 `pnpm pr:body render` 与 `gh pr view <number> --json body --jq .body`；远端该行成为 `expect(raw).toContain("\^[[31m")`。

## NiceEval identity

NiceEval checkout commit `7a8d51555e9d53e48471e6ef987f0b27c890df0b`，PR #173。

## Environment

Linux，Node 24，pnpm 11，gh CLI；通过仓库正式入口 `pnpm pr:body` 复现。

## Source provenance

输入来自本 checkout 的 Git-private managed draft 和 `e2e/cli/test/live-pty.test.ts`、`e2e/lifecycle/test/pty-terminal-cleanup.test.ts` 完整源码 directive。

## Public data confirmation

- [x] I removed secrets, credentials, private customer data, private repository content, and other sensitive material from this issue.
- [x] This issue does not disclose or describe a suspected security vulnerability.
