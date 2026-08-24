---
format: niceeval.feedback/v1
id: 20260824124020-e2e-report-parallel-timeout
title: 多 Repo E2E 并跑把已通过的 Report suite 超时报成 regression
state: open
reportedAt: 2026-08-24T12:40:20+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
subject: repository
claim: friction
observation: 同时运行 CLI、Eval 与 Report E2E 时，Report 的 Vitest 6 files / 13 tests 已全部通过，Playwright 随后开始运行，但仓库原生 test invocation 达到总时限后收到 SIGTERM，并被 E2E runner 归类为 regression。复用同一 candidate 单独运行 Report browser owner 时 2 tests 全部通过。
impact: 受影响仓库的多 Repo 一次性验收会产生假回归收据，维护者必须拆开 Report 的 Vitest 与 Playwright 运行才能证明同一 candidate 实际全绿。
memoryRelations: []
---
## Expected Behavior

`pnpm e2e test --repo cli --repo eval --repo report` 应给每个仓库足够的原生 suite 时间，或按阶段设置独立时限；已经完成的 Vitest 与随后正常推进的 Playwright 不应因共享总时限被归类为产品 regression。

## Current Behavior

同一 candidate `040743a8cc24a6c168c9b9d31aea1ffa2417ef599b5b31e66cf41f4c0120b949` 下，CLI 9 files / 12 tests 与 Eval 6 files / 6 tests clean pass。Report 的 Vitest 6 files / 13 tests 也全部通过，但耗时 171.61s；Playwright 开始后，原生 invocation 达到总时限，被 SIGTERM 终止，receipt 记录 `exitCode: null`、`timedOut: true`、`category: regression`。随后复用该 candidate 单独运行 `test/report.browser.spec.ts`，2 tests 在 29.6s 内 clean pass。

## Possible Solution

让多 Repo E2E 的原生 invocation 时限覆盖仓库声明的串行 runner 总预算，或让 Vitest 与 Playwright 成为各自计时和分类的 invocation；超时分类应与断言 regression 分开。

## Minimal Reproducible Example

```sh
pnpm e2e test --repo cli --repo eval --repo report
pnpm e2e run --candidate <first-command-candidate.tgz> --repo report -- --run test/report.browser.spec.ts
```

第一条在 Report Playwright 启动后超时并报告 regression；第二条使用同一 candidate 时 2/2 通过。

## Context

本轮 artifact receipt 为 `/tmp/niceeval-e2e-artifacts-FayKcX/report/receipt.json`。Report Vitest 与 browser target 均已分别通过，因此本轮改动没有借此跳过失败断言；摩擦只影响多 Repo 合并收据。
