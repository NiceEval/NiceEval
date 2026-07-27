# AI SDK

AI SDK 应用按被测边界接入：应用部署为 HTTP 服务时用 `uiMessageStreamAgent`；被测代码是已经跑在别处的 `generateText` / `streamText` 结果、只需要把它转成 `Turn` 时用 `turnFromAiSdk`。两者都不 import 应用代码，只认协议形状。

| 场景 | 入口 |
|---|---|
| 应用提供 UI Message Stream HTTP endpoint | `uiMessageStreamAgent(options)` |
| HTTP 返回 AI SDK `generateText` / `streamText` 结果形状 | `turnFromAiSdk(result)` |

`uiMessageStreamAgent` 管理 SSE reducer、全量历史重放和 tool approval 改写重发，适用于 AI SDK `useChat` 后端。

`turnFromAiSdk` 从 step content、tool call ID、tool result、approval part 与聚合 usage 构造 `Turn`。它兼容 AI SDK 多代字段名，但不负责 transport——请求怎么发、fetch 到哪个 endpoint 仍由调用方的 `defineAgent` 写。

可选 trace 集成从 `niceeval/adapter/otel` 导入 `aiSdkOtel()`；OTel 只生成 trace，不成为事件来源。

完整示例见 [`examples/zh/tier1/ai-sdk-v7/`](../../../../../examples/zh/tier1/ai-sdk-v7/)。

## 不提供进程内 Agent 工厂

`aiSdkAgent({ generate })` 仍作为 `niceeval/adapter` 的导出存在，但不是 AI SDK 应用的推荐接入方式——它测的是函数边界，不是应用真实部署的 HTTP 边界，属于[进程内调用](../../library/remote-agent.md#进程内调用)那条窄例外（被测循环本身就是目标边界、应用从未以 HTTP 形式部署时才用）。AI SDK 应用只要部署为 HTTP 服务，就应该用 `uiMessageStreamAgent` 对着真实 endpoint 测，而不是把应用的 `generateText` 循环包一层直接调用。
