# niceeval Examples

`examples/zh/` 按**接没接 niceeval** 分两组：

- `zh/origin/` —— **还没接 niceeval 的普通应用**。每个都是独立可跑的项目，不 import niceeval，且都是真调用各自 SDK 的最小 MVP（有基本的前后端，前后端接口按各 SDK 自己的最佳实践实现，没有 mock 模式）。它们是接入的 before 基线：接入后的版本放到 `zh/tier1/<同名目录>`（Tier 1 = 无侵入接入，见 [`docs/origin-integration.md`](../docs/origin-integration.md)），用 `pnpm run gen:diff-code` 统一对比"接入前后代码动了多少"。
- `zh/tier1/<name>` —— **接入 niceeval 之后的完整评测项目**，定义了 evals / experiments，能 `niceeval exp` 跑起来（需要先 `npm install -D niceeval`；这里的示例以 link 方式指向仓库根）。

`zh/tier1/<name>` 每个目录有独立的 `README.md`；`zh/origin/` 不再逐目录写 README，模型、HITL、跑法汇总在 [`zh/origin/README.md`](zh/origin/README.md) 的表格里，环境变量看各目录的 `.env.example`。

## 接入后（`zh/tier1/`）

五个应用无侵入接入(不改被测应用一行代码;应用由你自己按它的方式启动,eval 不代管进程、不另开端口,SDK 协议映射在 niceeval 官方包里,adapter 只剩传输粘合),对应 `docs/origin-integration.md` 的工单,全部实测跑通:

| 目录 | 用途 | before/after |
|---|---|---|
| [`zh/tier1/pi-sdk/`](zh/tier1/pi-sdk/) | 无侵入接 `@earendil-works/pi-agent-core`,手写 `AgentEvent` SSE 映射,`calculate` 工具 HITL 审批 | [文档](../docs-site/zh/example/tier1-pi-sdk.mdx) |
| [`zh/tier1/claude-sdk/`](zh/tier1/claude-sdk/) | 无侵入接 `@anthropic-ai/claude-agent-sdk`,手写 `SDKMessage` SSE 映射,`canUseTool` HITL 审批 | [文档](../docs-site/zh/example/tier1-claude-sdk.mdx) |
| [`zh/tier1/codex-sdk/`](zh/tier1/codex-sdk/) | 无侵入接 `@openai/codex-sdk`,`events: otelEvents({dialects:[otel.codex]})` 官方方言派生工具/usage,`spanMapper: mapCodexSpans` 归一瀑布图,消息文本从 SSE 补,真实编码任务 eval(建文件/跑命令) | [文档](../docs-site/zh/example/tier1-codex-sdk.mdx) |
| [`zh/tier1/langgraph/`](zh/tier1/langgraph/) | 无侵入接纯 Python LangGraph(`create_agent`),`events: otelEvents({dialects:[otel.langsmith]})`,方言解析不了的消息文本 + gated 工具由 adapter 手动补 | [文档](../docs-site/zh/example/tier1-langgraph.mdx) |
| [`zh/tier1/ai-sdk-v7/`](zh/tier1/ai-sdk-v7/) | 内置 `uiMessageStreamAgent` 无侵入接 AI SDK v7 的 UI Message Stream HTTP 端点,adapter 只剩配置(端点/model 透传);usage 从 `otel.genAi` span 派生 | [文档](../docs-site/zh/example/tier1-ai-sdk-v7.mdx) |

另外两个不属于这批工单的目录：

| 目录 | 用途 |
|---|---|
| [`zh/ai-sdk/`](zh/ai-sdk/) | **自己写 adapter**（`defineAgent` + `fromAiSdk`）接入 AI SDK v6 HTTP web agent，演示 remote adapter、事件流映射、双可观测 |
| [`zh/coding-agent-skill/`](zh/coding-agent-skill/) | 评测 Claude Code **Skill / Plugin** 对编码任务的实际提升（sandbox 工作区、文件断言） |

## 接入前（`zh/origin/`）

五个独立应用（ai-sdk-v7、langgraph、claude-sdk、codex-sdk、pi-sdk），各自真调用一个 agent framework/SDK，没有 mock 模式。模型、HITL 支持、跑法见 [`zh/origin/README.md`](zh/origin/README.md) 的表格，不在这里重复。

`openllmetry`、`openinference` 两个示例（OTel 自动埋点向，非 agent framework 向）暂时移除，`langgraph` 那批已做完（见上表），但这两个还没重做，仍是待办。

其中 `origin/langgraph` 同时是[连接可观测性指南](../docs-site/zh/guides/connect-otel.mdx)「2. 应用侧」LangSmith tab 的完整可跑版本（`origin/custom-genai` 已重写为 `origin/pi-sdk`，不再演示手写 OTel 埋点，「自己埋的 gen_ai」tab 暂时没有可跑参考实现）；`origin/claude-sdk`、`origin/codex-sdk` 对应仓库根 README「Agent Frameworks」Roadmap 的条目（Roadmap 勾选追踪 adapter 实现进度，不是示例有无）。
