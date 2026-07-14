# Codex SDK

`fromCodexThreadEvents()` 把 Codex SDK `thread.runStreamed()` 的 `ThreadEvent` 转换成标准事件。转换器覆盖消息、reasoning、command execution、文件变更、MCP 工具与 usage。

Codex SDK 负责 thread 持久化：首轮使用 `startThread()`，取得 thread ID 后写入 `ctx.session.capture()`；后续轮次用 `ctx.session.id` 调用 `resumeThread()`。转换器不持有 thread，也不决定 workspace。

Codex SDK 没有与 Claude Agent SDK `canUseTool` 等价的公开审批回调。不能观察到的 HITL 行为不得由 Adapter 猜测或伪造成 `input.requested`。

完整示例见 [`examples/zh/tier1/codex-sdk/`](../../../../../examples/zh/tier1/codex-sdk/)。Codex CLI 的 sandbox Adapter 与本 SDK 转换器共享事件词汇，但驱动和生命周期彼此独立。
