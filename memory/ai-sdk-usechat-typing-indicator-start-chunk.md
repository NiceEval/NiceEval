---
format: concord.document/v1
id: ai-sdk-usechat-typing-indicator-start-chunk
title: ai-sdk-usechat-typing-indicator-start-chunk
createdAt: 2026-07-03T13:18:10+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ai-sdk-usechat-typing-indicator-start-chunk.md
  commit: bd0e3e6aae8a54546a57ff973538f08e49bc4a7c
description: origin demos 前端"发消息后一片空白/看起来不 stream"的根因——useChat 收到 start chunk 就先推入一条空 parts 的 assistant 消息，按 role 判断的"思考中…"指示器会立刻消失
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：`examples/zh/origin/{codex-sdk,claude-agent-sdk,pi-sdk}` 三个 demo，用户发消息后界面长时间完全空白，看起来像"前端不 stream"、"对方回复消失了"。codex-sdk 上最严重（一轮要空白 10 秒以上）。

**根因**：两层。
1. 这几个 demo 的服务端在轮次一开始就写 `{type:"start"}` chunk（codex 在 `thread.started`、claude 在第一条 SDKMessage、pi 在 execute 开头）。AI SDK 的 `useChat` 一收到带 messageId/metadata 的 start 就会把一条 **parts 为空的 assistant 消息**推进 `messages`（见 `ai` 包 `AbstractChat` 的 `runUpdateMessageJob` → `write()` → `pushMessage`）。于是 `messages.at(-1)?.role !== "assistant"` 这种按 role 判断的"思考中…"指示器在首 token 到达前就消失了，剩下整段空白。
2. codex-sdk 上叠加了 SDK 本身的限制：`runStreamed()` 的 ThreadEvent 里 agent_message **没有 token 级增量**——没有 item.started/item.updated，只有一次性的 `item.completed`（实测事件序列：thread.started → turn.started → [10 秒空窗] → item.completed 整段文本）。所以 codex demo 的"流式"本来就只能整段上屏，空窗期只能靠指示器兜底。claude-agent-sdk（includePartialMessages）和 pi（text_delta）后端都是真 token 级流式，curl 直连和过 vite proxy 都验证过 chunk 是逐步到达的，问题只在指示器。

**修法**："思考中…"的显示条件不能只看 role，要看最后一条 assistant 消息有没有**可见内容**：`running && (last?.role !== "assistant" || !last.parts.some(p => (p.type==="text" && p.text) || isToolUIPart(p)))`。三个 demo 的 App.tsx 已改成这个判断（`waitingForReply` + `hasVisibleContent`）。排查这类"前端不 stream"时先用 curl 打后端 SSE 看 chunk 到达时序（区分是后端不吐、代理缓冲、还是前端渲染问题），再看指示器逻辑。

顺带：claude-agent-sdk 的 App.css 是从 ai-sdk-v7 抄的骨架,`.composer` 还是三列 grid（`auto minmax(0,1fr) auto`,第一列本来给图片上传按钮）,但 JSX 只有两个子元素,导致输入框掉进窄的 auto 列、发送按钮撑满 1fr 列变成巨宽——裁 JSX 时要连 CSS 一起裁。
