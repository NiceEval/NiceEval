# AI SDK 进程内 Direct Agent 仓库

## adapter-ai-sdk-direct-live-compatibility

Repo ID 是 `adapter/ai-sdk-direct`；manifest 声明 `areas: ["adapter"]`、live lanes、Node 22 与 external network。
被测公开入口是 `aiSdkAgent()`：Experiment 直接把真实 AI SDK `generateText()` 交给候选包的完整 Direct Agent factory，
不经过 HTTP、UI Message Stream 或 Repo 自写协议转换。

## 被测面

- `aiSdkAgent(options)` 创建并捕获会话 id，同一会话把 AI SDK `ModelMessage` 历史原样续到下一轮；
- 每轮真实结果只经 factory 内部的 `turnFromAiSdk()` 归一，工具 call/result 按 SDK 原生 ID 配对；
- `totalUsage` / `usage` 归一成逐轮正的互斥 token 桶；
- `ctx.signal` 原样交给 `generateText()` 的 `abortSignal`。

结果转换器自身的确定性语义由 [`adapter/sdk-converters`](sdk-converters.md#turnfromaisdk-deterministic)拥有；
本 Repo 只证明完整 factory、锁定 AI SDK 和真实 provider 仍可协作。

## Eval 闭环

唯一 `direct-agent` Eval 在首轮要求真实模型调用 `remember_marker`，断言原名、区分力入参、completed 配对及正的
input/output usage；同一 `t` 的第二轮必须从 factory 保存的消息历史回忆哨兵，并再次带回正 usage。
`t.sessionId` 同时证明 factory 已建立会话线。

## 仓库验收

- `attempts: 1`，无测试级 retry，也不使用 Judge；缺少 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 是 configuration failure。
- `niceeval exp` 在 Testkit 拥有的独立进程组内运行；每次 Journey 使用系统临时私有 `HOME`，cleanup 后不留子进程或认证目录。
- `show`、`show --json`、`show <eval> --history` 与 `show @locator --execution` 公开读回同一结果；execution 必须出现工具名与哨兵入参。
- 本 factory 未声明 tracing。独立 timing owner 只读回 runner 阶段，不重复 execution 或 OTel 断言。
