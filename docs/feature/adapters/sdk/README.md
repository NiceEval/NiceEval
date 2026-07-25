# SDK 与 Agent 接入

这里按 SDK 或 coding agent 名称拆分接入契约。每篇只记录该对象特有的公开入口和协议边界；通用写法见 [`../library.md`](../library.md)，架构纪律见 [`../architecture.md`](../architecture.md)。每个对象目录另有一篇 `cost.md`，声明该协议的 token 桶原生口径、归一到[恒互斥 Usage 契约](../../record/architecture.md#usage)的扣减规则，以及成本是实测带回还是价格表估算。

## 索引

| 对象 | 入口 | 形态 |
|---|---|---|
| [AI SDK](ai-sdk/README.md) | `fromAiSdk`、`uiMessageStreamAgent` | 结果转换器、HTTP 协议 Adapter |
| [OpenAI 兼容](openai-compat/README.md) | `fromChatCompletion`、`fromResponses` | 结果转换器（协议形状，不限 OpenAI 官方） |
| [Claude Agent SDK](claude-agent-sdk/README.md) | `fromClaudeSdkMessages` | SDK 事件转换器 |
| [Codex SDK](codex-sdk/README.md) | `fromCodexThreadEvents` | SDK 事件转换器 |
| [pi-agent-core](pi-agent-core/README.md) | `fromPiAgentEvents` | SDK 事件转换器 |
| [LangGraph](langgraph/README.md) | `fromLangGraphEvents` | 官方事件流转换器（不提供绑定部署方式的 Agent 工厂） |
| [Claude Code](claude-code/README.md) | `claudeCodeAgent` | Sandbox coding-agent Adapter |
| [Codex CLI](codex-cli/README.md) | `codexAgent` | Sandbox coding-agent Adapter |
| [Bub](bub/README.md) | `bubAgent` | Sandbox coding-agent Adapter |
| [OpenCode](opencode/README.md) | `openCodeAgent` | Sandbox coding-agent Adapter |
| [Hermes Agent](hermes/README.md) | `hermesAgent` | Sandbox coding-agent Adapter |
| [OpenClaw](openclaw/README.md) | `openClawAgent` | Sandbox coding-agent Adapter |

通用扩展调用见 [配置 Coding Agent 扩展](../library/coding-agent-extensions.md)。同名 CLI Adapter 与 SDK 转换器是不同接入形态。其它候选及不接判据见 [Adapter Roadmap](../../../roadmap/adapters/README.md)。
