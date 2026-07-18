# claude-agent-sdk 仓库

仓库 ID `claude-agent-sdk`，group `sdk`。被测应用是仓库自带的 Claude Agent SDK 服务：`query()` 驱动、带 MCP demo 工具与 `canUseTool` 审批接口，adapter 用 `fromClaudeSdkMessages()` 加 transport 粘合接入（契约见 [Claude Agent SDK 契约页](../../../feature/adapters/sdk/claude-agent-sdk/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| MCP 工具调用 | 工具以 MCP 命名出现——天气 Eval 直接断言 `mcp__demo-tools__get_weather`，`tool_use_id` 配对成立；反例断言未挂载的工具 `notCalledTool` |
| HITL 拒绝 | `canUseTool` 拒绝的工具带 `rejected` 状态，不产生工具结果；批准路径正常产生 `action.result` |
| 会话 | 首轮 `session_id` 经 `ctx.session.capture()` 捕获，后续轮以 resume 续接并能引用首轮事实 |
| usage 与 cost | result 帧的 usage、cost 与失败状态进入 `Turn`，逐轮非空 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现 `mcp__demo-tools__get_weather` 调用节点，时间注释显示 timing unavailable。
- **OTel**：本适配器不声明 tracing 面，验收脚本经 `openResults()` 断言 attempt 不产生 trace。
