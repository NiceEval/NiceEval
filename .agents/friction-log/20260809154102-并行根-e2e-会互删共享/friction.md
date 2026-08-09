---
title: '并行根 E2E 会互删共享 Testkit dist'
severity: 'major'
---

## Expected Behavior
两个 `pnpm e2e --repo …` invocation 并行时，应各自获得完整且不可变的 checkout-local Testkit，或在共享构建期间被可靠串行化；一个 invocation 不应使另一个已经安装并通过注入核验的 Testkit 入口消失。

## Current Behavior
`buildTestkitPackage()` 每个 invocation 都会无条件删除共享的 `packages/testkit/dist` 再重建。一个 runner 已把该目录作为 `file:` dependency 注入隔离副本后，另一个 runner 的 clean-build 可以在前者启动 Vitest 前删除入口。实际表现是 install 与 injection verification 都通过，随后 Vitest 报 `Failed to resolve entry for package "@niceeval/testkit"`。停止并行 runner 后，用相同 candidate、secret 和 Claude SDK 命令立即通过。

## Possible Solution
为 checkout-local Testkit 构建增加跨进程锁与内容身份，或让每次 invocation 注入构建完成后的不可变临时快照；不能继续让已安装的场景依赖一个会被其它 invocation 删除的共享 `dist`。同时增加两个无密钥 harness Repo 并行运行的确定性 runner E2E。

## Minimal Reproducible Example
在同一 checkout 同时启动两个声明 `harness.testkit: true` 的无密钥 Repo：
```sh
pnpm e2e --repo adapter/sdk-converters &
pnpm e2e --repo eval &
wait
```
竞态窗口取决于 install/test 时序；重复并行启动可观察某一侧在注入核验后无法解析 Testkit package entry。

## Context
本轮真实 Claude Agent SDK 验收与另一个 SDK converter 根 E2E 并行时出现。失败 receipt 位于 `/tmp/niceeval-e2e-artifacts-bacftx/adapter/claude-agent-sdk/receipt.json`，其中 prepare/install/injection 均成功，test 阶段入口缺失；停止另一个 invocation 后，相同命令在 `/tmp/niceeval-e2e-artifacts-ZDT5d9` 通过。CI 的独立 checkout 会降低触发概率，但本地 Herdr 并行验收是受支持的高频路径。
