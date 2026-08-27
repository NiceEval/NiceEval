# SDK 与 Agent 接入

这里按 SDK 或 coding agent 名称拆分接入契约。
每篇只记该对象特有的公开入口和协议边界；通用写法见 [`../library.md`](../library.md)，架构纪律见 [`../architecture.md`](../architecture.md)。
每个对象目录另有一篇 `cost.md`，声明该协议的 token 桶原生口径、归一到[恒互斥 Usage 契约](../../record/architecture.md)的扣减规则，
以及它是否有可写入 `Usage.costUSD` 的 provider / adapter observed USD 成本。

`Usage.costUSD` 从不收上游或本地的估算。Runner 的 `estimatedCostUSD` 始终独立来自 Config/runtime price table，且只供
`maxCost` 使用；Inspection 则只使用显式 PricingProfile 与 sealed Usage。

当前分类固定如下：Hermes 只转 `actual_cost_usd`；Claude Agent SDK 的 `total_cost_usd` 与 Bub 的 `usage.cost` 是 observed。pi 的
`u.cost.total`、OpenCode transcript 的 cost（models.dev/config）和 OpenClaw transcript 的 session-derived catalog cost 都是 estimate，
不得进入 `Usage.costUSD`。Hermes 的 `estimated_cost_usd` 也不得进入该字段。

## 索引

| 对象 | 入口 | 形态 |
|---|---|---|
| [AI SDK](ai-sdk/README.md) | `turnFromAiSdk`、`uiMessageStreamAgent` | 结果转换器、HTTP 协议 Adapter |
| [OpenAI 兼容](openai-compat/README.md) | `turnFromChatCompletion`、`turnFromResponses` | 结果转换器（协议形状，不限 OpenAI 官方） |
| [Claude Agent SDK](claude-agent-sdk/README.md) | `createClaudeSdkEventStream` | SDK 事件转换器 |
| [Codex SDK](codex-sdk/README.md) | `createCodexThreadEventStream` | SDK 事件转换器 |
| [pi-agent-core](pi-agent-core/README.md) | `createPiAgentEventStream` | SDK 事件转换器 |
| [LangGraph](langgraph/README.md) | `createLangGraphEventStream` | 官方事件流转换器（不提供绑定部署方式的 Agent 工厂） |
| [Claude Code](claude-code/README.md) | `claudeCodeAgent` | Sandbox coding-agent Adapter |
| [Codex CLI](codex-cli/README.md) | `codexAgent` | Sandbox coding-agent Adapter |
| [Bub](bub/README.md) | `bubAgent` | Sandbox coding-agent Adapter |
| [OpenCode](opencode/README.md) | `openCodeAgent` | Sandbox coding-agent Adapter |
| [Hermes Agent](hermes/README.md) | `hermesAgent` | Sandbox coding-agent Adapter |
| [OpenClaw](openclaw/README.md) | `openClawAgent` | Sandbox coding-agent Adapter |
| [Oh My Pi](omp/README.md) | `ompAgent` | Sandbox coding-agent Adapter |
| [DeepSeek Harness](deepseek-harness/README.md) | `deepSeekHarnessAgent` | Sandbox coding-agent Adapter |

通用扩展调用见 [配置 Coding Agent 扩展](../library/coding-agent-extensions.md)。
同名 CLI Adapter 与 SDK 转换器是不同接入形态。
其它候选及不接判据见 [Adapter Roadmap](../../../roadmap/README.md#adapter-准入目标)。
