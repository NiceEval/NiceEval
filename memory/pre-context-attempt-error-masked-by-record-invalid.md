# TestContext 前的 Attempt 错误被 Record invalid 覆盖

## 现象

2026-08-13，PR #47 的 Codex Docker/live E2E 中，Plugin 的真实 `agent.ensure` 错误最终只显示为
`runner-record-attempt-invalid`，`niceeval exp --json` 没有 receipt，CLI stderr 退化成
`niceeval error: [object Object]`。这让 Adapter 安装错误看起来像 Record 并发或产物损坏。

## 根因

物理 Attempt 已经创建沙箱并进入 ensure/setup，但错误发生在 `createAssertFirstEvalContext()`
之前，因此没有 Assertions runtime，也不会调用 `onSealedEvaluation`。调度器仍把它视为
`executed`，随后调用 `completeAttemptOrMarkIncomplete()`；Record 只接受已经 sealed 的 origin，
于是用 `runner-record-attempt-invalid` 覆盖了原始生命周期错误。

这类 Attempt 不能改成 `not-dispatched`：它已经真实执行并产生 sandbox、timing、commands 和
错误证据。也不能让 Record 接受没有 sealed Assertions 的 Member，那会破坏 Verdict/Score 与
Assertion origin 的一致性。

## 修法与验收

`runAttemptEffect()` 在 scoped 执行结束后检查本 Attempt 是否已经 sealed；若 TestContext 从未
建立，则按 Eval kind 创建唯一的空 Assertions runtime，以 `execution: "errored"` seal，再走
原有 `onSealedEvaluation` 和 Record 完成链。已有 runtime、timeout 或正常 author 路径不重复 seal。

本地故意给 Codex Plugin Experiment 配一个不存在的 configFile，公开输出现在包含原始
`agent.setup` error、errored locator 和最终 receipt；随后 `niceeval show <locator> --execution`
可读回 0.144.1 probe、0.146.0 安装/recheck、原始 configFile 错误与完整 timing。修法落在
`src/runner/attempt.ts`。
