---
format: concord.document/v1
id: ai-sdk-v7-streamtext-reuse-and-gateway-image-limits
title: ai-sdk-v7-streamtext-reuse-and-gateway-image-limits
createdAt: 2026-07-03T05:24:42+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ai-sdk-v7-streamtext-reuse-and-gateway-image-limits.md
  commit: eb582131f9cc4cccadc48a5a769e9b65062873b8
description: eval 复用生产 streamText 调用的正确姿势（v7 结果字段 await 即自动消费流），以及
  OPENAI_BASE_URL 网关不支持图像输入的处理位置（eval 侧 skip，不改应用模型元数据）
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**现象**：`examples/zh/ai-sdk-v7` 最初为 niceeval 接入单独加了一条 `generateText` 路径（`chat()`），和生产在跑的 `streamChat`（`streamText`）平行——eval 测不到生产真正的调用，`stopWhen` 等调用配置也要维护两份。另外为绕过网关传图被拒的问题，把 `src/models.ts` 里 gpt-5.4 的 `supportsVision` 翻成了 false，导致真实 web UI 也会对 gpt-5.4 剥图，且 `compare-models/gpt-5.4.ts` 里「image-understanding 只在这格真跑」的注释随之失效（其实一格都没真跑过）。

**根因**：
1. 以为 `aiSdkAgent.generate` 需要 `generateText` 的 awaited 结果所以另起路径。实际 AI SDK v7 的 `StreamTextResult` 上 `text` / `steps` / `content` / `totalUsage` / `responseMessages` 都是标注了 "Automatically consumes the stream" 的 PromiseLike——直接 `Promise.all` await 这五个字段就能拼出 `fromAiSdk` 认识的完整结果形状，不需要 `consumeStream()`，也不需要 generateText。
2. 网关限制（`OPENAI_BASE_URL` 转 Responses API 不认 data URL，报 "Expected a valid URL"）是**环境问题**，写进应用的模型能力元数据等于让 eval 环境污染生产行为。

**修法**：
1. 应用只保留一个模型调用点（`chat(messages, modelId?, opts?)` 返回 streamText 结果），UI 的 `streamChat` 做完 UIMessage 转换后走它；eval 侧在 `experiments/assistant.ts` 的 `generate` 里 await 五个字段聚合返回。eval 与生产共用同一次调用，HITL（approval 请求在 content parts、resume 靠 responseMessages）、usage、tracing 全部验证可用（hitl-approve / hitl-deny / weather-tool 等 6 条 eval 实跑通过）。
2. 环境性 skip 写在 eval 里（`image-understanding.eval.ts`：`OPENAI_BASE_URL` 存在且模型 provider 是 openai 时 `t.skip`），不改 `src/models.ts`——after 的 models.ts 应与 before 逐字节相同，这是 before/after diff 文档「应用几乎不动」叙事的一部分。
3. 反直觉之处：给「eval 专用」加一条更简单的 generateText 路径看似无害，实际同时破坏了测试保真度（测的不是生产路径）和 diff 叙事（应用侧多了一坨 eval 才用的代码）。判断标准：应用侧新增的东西必须是生产路径自己也在用的。
