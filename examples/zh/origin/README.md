# origin 示例一览

这些都是**还没接 niceeval 的独立应用**，各自真调用对应 SDK，没有 mock 模式。环境变量按各目录的 `.env.example` 配置即可，不再单独写 README。

每个示例都是同一个分层结构：**HTTP 服务器(无框架) → 前后端协议 → agent runtime**，外加前端。下面矩阵里的每一行是一个独立的层/维度，彼此正交、可以自由组合——换掉某一格的取值（比如把 langgraph 的自定义帧换成 AI SDK 协议、给 pi-sdk 换一个前端库）不需要动其它行。

协议这一行刻意保持多样：ai-sdk-v7 走 AI SDK 的通用 UI Message Stream，另外三个 TS 示例把各自 SDK 的**原生事件流原样透传**（服务端零翻译），langgraph 是自定义 JSON 帧。assistant-ui 并不认识这三套原生协议——`ChatModelAdapter` 是 `useLocalRuntime` 留的自定义后端接口，每个示例各写一个 adapter 把自家原生流翻译成 assistant-ui 统一的 content parts；协议解析是各示例自己的代码，assistant-ui 只承担聊天状态/composer/停止这些 UI 杂务。

| 维度 | [`ai-sdk-v7/`](ai-sdk-v7/) | [`claude-sdk/`](claude-sdk/) | [`codex-sdk/`](codex-sdk/) | [`pi-sdk/`](pi-sdk/) | [`langgraph/`](langgraph/) |
|---|---|---|---|---|---|
| **Agent runtime** | AI SDK v7 `streamText` 工具循环（进程内） | Claude Agent SDK `query()`（spawn claude-code CLI 子进程） | Codex SDK `thread.runStreamed()`（spawn codex CLI 子进程） | pi-agent-core `Agent`（进程内 agent loop） | LangChain `create_agent`（编译好的 LangGraph 图，进程内） |
| **HTTP 层** | `node:http`，无框架 | `node:http`，无框架 | `node:http`，无框架 | `node:http`，无框架 | Python 标准库 `http.server`，无框架 |
| **前后端协议** | AI SDK UI Message Stream（SSE，官方 `toUIMessageStream` 转换） | SDK 原生 `SDKMessage` 流原样透传（SSE，含 Anthropic 原始 stream_event，逐 token） | SDK 原生 `ThreadEvent` 流原样透传（SSE；agent_message 无 token 级增量） | SDK 原生 `AgentEvent` 流原样透传（SSE，逐 token）+ session/approval 两种传输层帧 | 自定义 JSON 事件帧 over SSE |
| **前端** | React + `@ai-sdk/react` `useChat`（带模型选择器、图片上传） | assistant-ui `useLocalRuntime`，自写 adapter 解析 `SDKMessage` 流，审批按钮画在工具气泡上 | assistant-ui `useLocalRuntime`，自写 adapter 解析 `ThreadEvent` 流 | assistant-ui `useLocalRuntime`，自写 adapter 解析 `AgentEvent` 流 + approval 帧，审批按钮画在工具气泡上 | 原生 HTML+JS，`fetch` 手读 SSE |
| **会话续接** | 无服务端状态：每轮整份 `messages[]` 重放 | SDK session 落盘 `~/.claude`，`resume: sessionId` | SDK thread 落盘 `~/.codex/sessions`，`resumeThread(threadId)` | 服务端内存 `Map<sessionId, agent.state.messages>` 回灌（pi 无落盘 resume 机制） | LangGraph checkpointer + `thread_id` |
| **HITL 审批的 tool** | `calculate`（AI SDK `needsApproval`） | `calculate`（`canUseTool`） | 无（Codex SDK 不支持） | `calculate`（`beforeToolCall`） | `calculate`（LangGraph 原生 `interrupt()` + `HumanInTheLoopMiddleware`） |
| **OTel** | 官方 `@ai-sdk/otel` 集成 + `registerTelemetry()`，GenAI 语义 spans（见 `src/backend/otel.ts`） | claude-code CLI 原生遥测：`CLAUDE_CODE_ENABLE_TELEMETRY=1` 那组环境变量，导出 metrics + logs（无 trace spans） | Codex CLI 原生 `otel` 配置段（`trace_exporter` → otlp-http，见 `src/backend/agent.ts`），导出 CLI 内部 trace spans | SDK 无官方 OTel 支持，未接 | LangSmith 零代码 OTel：设 4 个环境变量自动接 OTLP exporter |
| **模型(默认)** | deepseek-v4-flash（可切 deepseek-v4-pro / gpt-4o-mini / gpt-5.4） | deepseek-v4-flash（可切 claude-sonnet-5 等） | gpt-5.4 | deepseek-v4-flash（可切 deepseek-v4-pro） | gpt-4o-mini |
| **跑起来** | `pnpm install && pnpm dev` → http://localhost:34000 | `pnpm install && pnpm dev` → http://localhost:32000 | `pnpm install && pnpm dev` → http://localhost:31000 | `pnpm install && pnpm dev` → http://localhost:33000 | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python src/backend/server.py` → http://localhost:35000 |

所有项目跑之前都要 `cp .env.example .env` 并填好对应的 key。OTel 默认开启，不做「设了才导出」的判断——各示例 `.env.example` 里的 OTel 相关变量已经给了本地默认值（通常指向 `localhost:4318`），照抄照跑就有数据；没起收集器时导出只是在后台失败重试，不影响主流程。

但 OTel 只负责**收集**，不保证**格式**：上表五种接法产出的 span/metric 不是同一种 schema——ai-sdk-v7 是标准 GenAI semconv，codex-sdk 是 Codex CLI 自家的 span 命名（`codex.exec`/`run_sampling_request`/…），claude-sdk 甚至不发 trace span（只有 metrics + logs），langgraph 走 LangSmith 混合格式。接这批数据的一方（比如 niceeval）得靠专属 mapper + 通用 heuristic 兜底把它们翻译成统一语义，不能假设几家产的数据本来就一致。
