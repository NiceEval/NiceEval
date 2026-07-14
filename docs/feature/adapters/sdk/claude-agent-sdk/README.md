# Claude Agent SDK

`fromClaudeSdkMessages()` 把 Claude Agent SDK `query()` 返回的 `SDKMessage` 流转换成标准事件。Adapter 使用 `sseJsonFrames` 和 `driveFrameStream` 时只需保留 endpoint、请求体与审批接口等 transport 粘合。

转换器负责：

- assistant text、thinking 与工具生命周期；
- `tool_use_id` 配对；
- result 帧的 usage、cost 与失败状态；
- `session_id` 提取；
- 被拒绝工具的 `rejected` 状态。

会话 ID 由 Adapter 写入 `ctx.session.capture()`，后续请求使用 `ctx.session.id` 传给 SDK 的 resume 选项。`canUseTool` 如何暴露为应用端审批接口属于被测应用协议，不由转换器规定。

完整示例见 [`examples/zh/tier1/claude-sdk/`](../../../../../examples/zh/tier1/claude-sdk/)。Claude Code CLI 的 sandbox Adapter 是另一种接入形态，不与本转换器合并。
