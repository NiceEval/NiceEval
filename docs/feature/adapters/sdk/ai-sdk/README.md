# AI SDK

AI SDK 应用按被测边界接入：应用部署为 HTTP 服务时用 `uiMessageStreamAgent`；被测代码是已经跑在别处的 `generateText` / `streamText` 结果、只需要把它转成 `Turn` 时用 `turnFromAiSdk`。
两者都不 import 应用代码，只认协议形状。

| 场景 | 入口 |
|---|---|
| 应用提供 UI Message Stream HTTP endpoint | `uiMessageStreamAgent(options)` |
| HTTP 返回 AI SDK `generateText` / `streamText` 结果形状 | `turnFromAiSdk(result)` |

`uiMessageStreamAgent` 管理 SSE reducer、全量历史重发和 tool approval 改写重发，适用于 AI SDK `useChat` 后端。

官方 reducer 每次产生新的 assistant message 状态时，Adapter 只从 `input-available` 或更后状态读取工具。
call ID、tool name 与完整 input 都存在时，Human live 面板显示一次 `tool:` detail；raw input delta 不触发进度。
同一 call ID 在 approval resume 中不会重报。Runner 单独显示 `user:`，两类 detail 都不进入 Record 或 timeout error。

一条完整响应必须以 AI SDK 的 `data: [DONE]` SSE 帧结束。标准 AI SDK endpoint 会写出该标记；自定义兼容 endpoint 也必须保留它。
`[DONE]` 是 reducer 的协议终点，后续帧不会再成为 Turn 的一部分。如果连接在 `[DONE]` 前结束，Adapter 不接受已经收到的部分 assistant 内容，而是返回 send failure。公开诊断会说明响应被截断或 endpoint 没有实现完整协议。

UI Message Stream 不携带 command 分类。Endpoint owner 如需可信的工具负断言与 command 断言，可以传
`projectToolCommand({ name, input })`，逐笔返回 `commandProjection(...)`、
`notCommandProjection()` 或 `undefined`。`undefined` 会如实保持 actions coverage partial。
NiceEval 不会从工具名或 input 猜测分类。

`approval-requested` 表示模型已经宣布一条逻辑工具调用，但副作用尚未执行。
因此等待审批的 Turn 先公开一次 `operation.started`，随后公开
`input.requested`，不公开 `operation.finished`。批准后的 resume 只补同一 call
ID 的 completed/output；拒绝的 `tool-output-denied` 只补 rejected 且没有 output。重发历史不得重复
start，同一会话的新 user send 则重置本条消息的增量簿记。

`turnFromAiSdk` 从 step content、tool call ID、tool result、approval part 与聚合 usage 构造 `Turn`。
它兼容 AI SDK 多代字段名，但不负责 transport——请求怎么发、fetch 到哪个 endpoint 仍由调用方的 `defineAgent` 写。

可选 trace 集成从 `niceeval/adapter/otel` 导入 `aiSdkOtel()`；OTel 只生成 trace，不成为事件出处。

完整示例见 [`examples/zh/tier1/ai-sdk-v7/`](../../../../../examples/zh/tier1/ai-sdk-v7/)。

## 不提供进程内 Agent 工厂

`aiSdkAgent({ generate })` 仍作为 `niceeval/adapter` 的导出存在，但不是 AI SDK 应用的推荐接入方式——它测的是函数边界，不是应用真实部署的 HTTP 边界，属于[进程内调用](../../library/direct-agent.md#进程内调用)那条窄例外（被测循环本身就是目标边界、应用从未以 HTTP 形式部署时才用）。
AI SDK 应用只要部署为 HTTP 服务，就应该用 `uiMessageStreamAgent` 对着真实 endpoint 测，而不是把应用的 `generateText` 循环包一层直接调用。
`generate` 返回前没有统一的增量协议，因此这个入口不投影实时 tool detail。
