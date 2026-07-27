# pi-agent-core

`createPiAgentEventStream()` 把 `@earendil-works/pi-agent-core` 的 `AgentEvent` 流转换成标准事件。它处理消息开始/增量/结束、工具执行、usage 和失败状态。

pi-agent-core 没有服务端落盘 resume 契约。应用若把历史保存在客户端，Adapter 用私有 typed session slot 读取并提交完整消息；应用若自建 session 服务，则使用 `ctx.session.id` / `capture()`。

工具审批由应用自己的 `beforeToolCall` 或等价 Hook 暴露。暂停时 Adapter 用私有 typed session slot 保存尚未消费完的流，回答轮用 `take(slot)` 恢复。

完整示例见 [`examples/zh/tier1/pi-sdk/`](../../../../../examples/zh/tier1/pi-sdk/)。
