---
format: concord.document/v1
id: claude-agent-sdk-permission-mode-silent-skip
title: claude-agent-sdk-permission-mode-silent-skip
createdAt: 2026-07-03T05:24:42+08:00
createdAtSource:
  kind: first-recorded
  path: memory/claude-agent-sdk-permission-mode-silent-skip.md
  commit: eb582131f9cc4cccadc48a5a769e9b65062873b8
description: "@anthropic-ai/claude-agent-sdk 的 query() 默认 permissionMode 在无终端的
  headless 服务里会静默跳过工具调用，模型转而幻觉答案，不报错"
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**现象**：`examples/zh/origin/claude-agent-sdk` 改成真实调用 DeepSeek(经 `ANTHROPIC_BASE_URL` 走 anthropic 兼容端点)后，第一次跑「北京天气」返回了一个看起来合理但和 `WEATHER_TABLE` 对不上的假读数(26°C 而不是表里的 24°C，还编了湿度/风力)；问算式时模型直接回复"需要调用计算工具来帮你算，请先授权"，工具调用完全没发生——但请求没有报错，HTTP 200 正常返回。

**根因**：SDK `query()` 的 `options.permissionMode` 默认是 `'default'`，这个模式下每次工具调用都要交互式确认(等终端输入)。这个 demo 是无终端的 `node:http` 服务器，没有 TTY 可以答复这个确认——SDK 不报错、不阻塞，而是让模型收到"工具不可用"的信号，模型于是选择编答案搪塞，从用户能看到的响应看完全是"正常"的一次对话。

**修法**(2026-07-02 更新)：官方 permissions 文档对"固定工具面的 headless agent"给的组合是 `allowedTools: ["mcp__<server>__*"]` + `permissionMode: "dontAsk"`——名单内直接放行、名单外硬拒绝,比早先用的 `bypassPermissions` + `allowDangerouslySkipPermissions: true` 更收敛(bypass 模式下 `allowedTools` 完全不约束,文档标注 "use with extreme caution")。`examples/zh/origin/claude-agent-sdk/agent.ts` 已改用 dontAsk 组合。**适用场景边界**：无人值守服务一律别留默认 `permissionMode: 'default'`(会静默跳工具);要把审批交还给人时才用 `canUseTool` 回调。这条也是给以后接 claude-agent-sdk 类似 adapter 时的正确默认参照,见 [[docs-otel-mixin-not-implemented]] 里提到的"结构化 SDK message stream,手写 T1 映射成本低"这条路径要用这个例子作为起点。
