---
format: concord.document/v1
id: pi-agent-core-no-session-persistence
title: pi-agent-core-no-session-persistence
createdAt: 2026-07-03T13:18:10+08:00
createdAtSource:
  kind: first-recorded
  path: memory/pi-agent-core-no-session-persistence.md
  commit: bd0e3e6aae8a54546a57ff973538f08e49bc4a7c
description: pi SDK(@earendil-works/pi-agent-core)的 Agent 没有 Codex thread /
  Claude session 那种落盘 resume 机制,多轮会话必须由服务端自己保存并回灌 agent.state.messages
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**现象**：`examples/zh/origin/pi-sdk` demo 多轮对话上下文丢失——上一轮刚问"福建哪个城市"，用户答"福州"，模型却当成全新对话重新自我介绍。

**根因**：pi 的 `Agent` 是纯内存对象，没有任何跨进程/跨请求的会话持久化（不像 Codex SDK 的 thread 落盘在 ~/.codex/sessions、Claude Agent SDK 的 session 落盘在 ~/.claude/projects）。demo 的 server.ts 原来每次 /api/chat 都 `new Agent()` 且只喂当轮 `body.message`，历史自然全丢。

**修法**：`AgentState.messages` 是可赋值的（`initialState?: Partial<Omit<AgentState, ...>>` 接受 `messages: AgentMessage[]`），所以服务端用 `Map<sessionId, AgentMessage[]>` 保存每轮结束后的 `agent.state.messages`，下一轮经 `createAgent({ messages: sessions.get(sessionId) })` 回灌；sessionId 由服务端生成、通过 start chunk 的 `messageMetadata` 发给前端，前端 ref 存住随下一轮请求带回（和 codex/claude demo 的 threadId/sessionId 回传模式一致）。已在 server.ts/agent.ts/App.tsx 落地并实测两轮上下文续接成功。注意 `sessions.set` 放在 `waitForIdle()` 成功之后，出错的轮次不覆盖历史。
