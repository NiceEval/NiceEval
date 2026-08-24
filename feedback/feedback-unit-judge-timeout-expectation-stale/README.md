---
format: niceeval.feedback/v1
id: feedback-unit-judge-timeout-expectation-stale
title: Judge timeout 单元测试与当前 unavailable 证据不一致
state: open
reportedAt: 2026-08-24T12:47:31+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: e8b4f34d9436453f088c39b3489da52174a5a2e9
subject: repository
claim: friction
observation: 在未修改 assertions/judge 生产代码或测试的工作树运行 `pnpm exec vitest run --project unit`，`Judge virtual-time lifecycle > timeout stays pending before its boundary, then interrupts the provider request` 稳定失败；单独复跑仍失败。测试期望 unavailable 结果携带包含 timeout 的 `evidence`，当前结果只有 state、reason 与 detail。
impact: 全量 unit suite 在与 Report UI 无关的改动上保持红灯，贡献者无法用该门禁区分本次回归与既有 Judge 测试／实现漂移。
memoryRelations: []
---
# Judge timeout 单元测试与当前 unavailable 证据不一致

复现命令：`pnpm exec vitest run --project unit packages/niceeval/src/assertions/judge.test.ts -t "timeout stays pending before its boundary, then interrupts the provider request"`。在 commit `e8b4f34d9436453f088c39b3489da52174a5a2e9` 上连续两次稳定失败；本次 Report UI diff 不触及 `packages/niceeval/src/assertions/judge.ts` 或对应测试。