# AI SDK

AI SDK 有三种接入面，按被测应用的真实边界选择。

| 场景 | 入口 |
|---|---|
| HTTP 返回 AI SDK `generateText` / `streamText` 结果形状 | `fromAiSdk(result)` |
| 被测循环就在 eval 进程中运行 | `aiSdkAgent({ generate })` |
| 应用提供 UI Message Stream HTTP endpoint | `uiMessageStreamAgent(options)` |

`fromAiSdk` 从 step content、tool call ID、tool result、approval part 与聚合 usage 构造 `Turn`。它兼容 AI SDK 多代字段名，但不负责 transport。

`aiSdkAgent` 负责无状态消息历史、事件转换和 approval 恢复。它测的是进程内函数；需要覆盖生产 HTTP 路径时应使用 remote Adapter。

`uiMessageStreamAgent` 管理 SSE reducer、全量历史重放和 tool approval 改写重发，适用于 AI SDK `useChat` 后端。

可选 trace 集成从 `niceeval/adapter/otel` 导入 `aiSdkOtel()`；OTel 只生成 trace，不成为事件来源。

完整示例见 [`examples/zh/tier1/ai-sdk-v7/`](../../../../../examples/zh/tier1/ai-sdk-v7/)。
