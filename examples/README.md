# niceeval Examples

`examples/zh/` 按**接没接 niceeval** 分两组：

- `zh/origin/` —— **还没接 niceeval 的普通应用**。每个都是独立可跑的项目，不 import niceeval，且都是真调用各自 SDK 的最小 MVP（有基本的前后端，前后端接口按各 SDK 自己的最佳实践实现，没有 mock 模式）。它们是接入的 before 基线：接入后的版本放到 `zh/eval/<同名目录>`，用 `pnpm run gen:diff-code` 统一对比"接入前后代码动了多少"。
- `zh/eval/<name>` —— **接入 niceeval 之后的完整评测项目**，定义了 evals / experiments，能 `niceeval exp` 跑起来（需要先 `npm install -D niceeval`；这里的示例以 link 方式指向仓库根）。

每个目录都有独立的 `README.md` 说明如何配置环境变量并运行。

## 接入后（`zh/eval/` 等）

| 目录 | 用途 |
|---|---|
| [`zh/eval/ai-sdk-v7/`](zh/eval/ai-sdk-v7/) | **官方内建适配器 `aiSdkAgent`** 接入 AI SDK v7 应用：tool approval HITL、多模态、tracing，eval 与 UI 共用同一次模型调用。before 基线：[`zh/origin/ai-sdk-v7/`](zh/origin/ai-sdk-v7/)，代码 diff 见 [before/after 文档](../docs-site/zh/example/ai-sdk-v7-before-after.mdx) |
| [`zh/eval/langgraph/`](zh/eval/langgraph/) · [`zh/eval/claude-agent-sdk/`](zh/eval/claude-agent-sdk/) · [`zh/eval/codex-sdk/`](zh/eval/codex-sdk/) | 自己写 remote/deployed adapter 接入对应 origin 应用的早期快照 |
| [`zh/eval/custom-genai/`](zh/eval/custom-genai/) | 走 OTel 通道接入对应 origin 应用 |
| [`zh/ai-sdk/`](zh/ai-sdk/) | **自己写 adapter**（`defineAgent` + `fromAiSdk`）接入 AI SDK v6 HTTP web agent，演示 remote adapter、事件流映射、双可观测 |
| [`zh/coding-agent-skill/`](zh/coding-agent-skill/) | 评测 Claude Code **Skill / Plugin** 对编码任务的实际提升（sandbox 工作区、文件断言） |

## 接入前（`zh/origin/`）

| 目录 | 应用形态 | 前后端接口 |
|---|---|---|
| [`zh/origin/ai-sdk-v7/`](zh/origin/ai-sdk-v7/) | AI SDK v7 聊天应用（HTTP 服务器 + React UI） | AI SDK UI message stream + `useChat` |
| [`zh/origin/langgraph/`](zh/origin/langgraph/) | **纯 Python**：`langgraph.graph.StateGraph` 手搭的 ReAct 循环（不走 `create_react_agent`/`create_agent` 高层封装）+ **LangSmith** OTel 导出（Python 版真·零代码，纯 env 驱动） | 标准库 `http.server` 手写 SSE（`POST /api/chat`）+ 单文件 `public/index.html`（无前端构建、无跨语言） |
| [`zh/origin/claude-agent-sdk/`](zh/origin/claude-agent-sdk/) | **Claude Agent SDK**（`@anthropic-ai/claude-agent-sdk`，MCP 工具 + resume 续会话） | SSE 透传 `SDKMessage` 流（官方 hosting 形态，`includePartialMessages` 逐 token 出字） |
| [`zh/origin/codex-sdk/`](zh/origin/codex-sdk/) | **Codex SDK**（`@openai/codex-sdk`，coding-agent-in-a-directory 的任务形状） | SSE 透传 `runStreamed()` 的 `ThreadEvent` 流 |
| [`zh/origin/vm0/`](zh/origin/vm0/) | **vm0**（托管 agent 运行时，`vm0.yaml` agent compose + 平台沙箱跑 claude-code） | 后端打 vm0 公开 REST 契约（创建 run + 轮询 events），SSE 转发 claude-code stream-JSON 事件 |
| [`zh/origin/custom-genai/`](zh/origin/custom-genai/) | 不用 vendor SDK，`@opentelemetry/api` **手写 GenAI 语义约定 span** | `node:http` + JSON(同上) |

`openllmetry`、`openinference` 两个示例（OTel 自动埋点向，非 agent framework 向）暂时移除，等
`langgraph` 那批做完后再回来重做。

其中 `origin/langgraph`、`origin/custom-genai` 同时是[连接可观测性指南](../docs-site/zh/guides/connect-otel.mdx)「2. 应用侧」各 tab 的完整可跑版本；`origin/claude-agent-sdk`、`origin/codex-sdk`、`origin/vm0` 对应仓库根 README「Agent Frameworks」Roadmap 的条目（Roadmap 勾选追踪 adapter 实现进度，不是示例有无）。
