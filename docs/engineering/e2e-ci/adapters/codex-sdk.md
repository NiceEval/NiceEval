# codex-sdk 仓库

仓库 ID `codex-sdk`，group `sdk`。被测应用是仓库自带的 Codex SDK 服务：`thread.runStreamed()` 驱动、带工作区与 MCP 工具，adapter 用 `fromCodexThreadEvents()` 接入（契约见 [Codex SDK 契约页](../../../feature/adapters/sdk/codex-sdk/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| coding tool | command execution 与文件变更事件进入标准事件流，调用与结果配对成立 |
| MCP 工具调用 | MCP 工具出现在 `action.called`；反例断言未挂载的工具 `notCalledTool` |
| 会话 | 首轮 `startThread()` 的 thread ID 经 `ctx.session.capture()` 捕获，后续轮 `resumeThread()` 续接并能引用首轮事实 |
| usage | reasoning 与 usage 逐轮进入 `Turn` |
| HITL 反例 | Codex SDK 没有公开审批回调——断言事件流从不出现 `input.requested`，证明 adapter 不猜测、不伪造观察不到的 HITL |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现 command execution 与文件变更节点，时间注释显示 timing unavailable。
- **OTel**：本适配器不声明 tracing 面，验收脚本经 `openResults()` 断言 attempt 不产生 trace。
