# origin 示例一览

这些都是**还没接 niceeval 的独立应用**，各自真调用对应 SDK，没有 mock 模式。环境变量按各目录的 `.env.example` 配置即可，不再单独写 README。

每个示例都是同一个分层结构：**HTTP 服务器(无框架) → 协议翻译层 → agent runtime**，外加一个只认协议、不认 SDK 的前端。下面矩阵里的每一行是一个独立的层/维度，彼此正交、可以自由组合——换掉某一格的取值（比如给 pi-sdk 接 OTel、把 langgraph 的自定义帧换成 AI SDK 协议）不需要动其它行。

| 维度 | [`ai-sdk-v7/`](ai-sdk-v7/) | [`claude-agent-sdk/`](claude-agent-sdk/) | [`codex-sdk/`](codex-sdk/) | [`pi-sdk/`](pi-sdk/) | [`langgraph/`](langgraph/) |
|---|---|---|---|---|---|
| **Agent runtime** | AI SDK v7 `streamText` 工具循环（进程内） | Claude Agent SDK `query()`（spawn claude-code CLI 子进程） | Codex SDK `thread.runStreamed()`（spawn codex CLI 子进程） | pi-agent-core `Agent`（进程内 agent loop） | LangChain `create_agent`（编译好的 LangGraph 图，进程内） |
| **HTTP 层** | `node:http`，无框架 | `node:http`，无框架 | `node:http`，无框架 | `node:http`，无框架 | Python 标准库 `http.server`，无框架 |
| **前后端协议** | AI SDK UI Message Stream（SSE）：官方 `toUIMessageStream` 直接转 | AI SDK UI Message Stream（SSE）：手写 SDKMessage→UIMessageChunk 翻译（`ui-stream.ts`） | AI SDK UI Message Stream（SSE）：手写 ThreadEvent→UIMessageChunk 翻译（`src/ui-stream.ts`） | AI SDK UI Message Stream（SSE）：手写 AgentEvent→UIMessageChunk 翻译（内联在 `server.ts`） | 自定义 JSON 事件帧 over SSE（非 AI SDK 协议） |
| **前端** | React + `@ai-sdk/react` `useChat`（带模型选择器、图片上传） | React + `useChat` | React + `useChat` | React + `useChat` | 原生 HTML+JS，`fetch` 手读 SSE |
| **会话续接** | 无服务端状态：每轮整份 `messages[]` 重放 | SDK session 落盘 `~/.claude`，`resume: sessionId` | SDK thread 落盘 `~/.codex/sessions`，`resumeThread(threadId)` | 服务端内存 `Map<sessionId, agent.state.messages>` 回灌（pi 无落盘 resume 机制） | LangGraph checkpointer + `thread_id` |
| **HITL 审批的 tool** | `calculate`（AI SDK `needsApproval`） | `calculate`（`canUseTool`） | 无（Codex SDK 不支持） | `calculate`（`beforeToolCall`） | `calculate`（LangGraph 原生 `interrupt()` + `HumanInTheLoopMiddleware`） |
| **OTel** | 未接 | 未接 | 未接 | 未接 | LangSmith 零代码 OTel：设 `LANGSMITH_TRACING` / `LANGSMITH_OTEL_ENABLED` / `LANGSMITH_OTEL_ONLY` / `OTEL_EXPORTER_OTLP_ENDPOINT` 即自动接 OTLP exporter |
| **模型(默认)** | deepseek-v4-flash（可切 deepseek-v4-pro / gpt-4o-mini / gpt-5.4） | deepseek-v4-flash（可切 claude-sonnet-5 等） | gpt-5.4 | deepseek-v4-flash（可切 deepseek-v4-pro） | gpt-4o-mini |
| **跑起来** | `pnpm install && pnpm dev` → http://localhost:5173 | `pnpm install && pnpm dev` → http://localhost:5173 | `pnpm install && pnpm dev` → http://localhost:5173 | `pnpm install && pnpm dev` → http://localhost:5300 | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python src/server.py` → http://localhost:5488 |

所有项目跑之前都要 `cp .env.example .env` 并填好对应的 key。
