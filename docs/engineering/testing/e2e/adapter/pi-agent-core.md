# pi-agent-core 仓库

仓库 ID `pi-agent-core`，group `sdk`。被测应用是仓库自带的 pi-agent-core 循环：`AgentEvent` 流经 `createPiAgentEventStream()` 归一，历史保存在客户端，审批经 `beforeToolCall` 生命周期 Hook 暴露（契约见 [pi-agent-core 契约页](../../../../feature/adapters/sdk/pi-agent-core/README.md)）。

## Eval 闭环

| 协议行为         | Eval 断言（只读事件流）                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 工具执行         | 消息开始/增量/结束与工具执行事件归一进标准事件流，调用与结果配对成立；反例断言未提供的工具 `notCalledTool`                              |
| 会话             | 客户端历史经 Adapter 私有的 typed slot 读取并整体提交，第二轮能引用首轮事实                                                                    |
| HITL 暂停恢复    | `beforeToolCall` 暂停时产生 `input.requested`，未消费完的流经 typed slot 保存，回答轮 `take(slot)` 恢复并出现对应 `action.result`               |
| usage 与失败状态 | usage 逐轮进入 `Turn`；失败状态如实归一，不折成普通消息                                                                                 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 默认报告列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具执行节点，时间注释显示 timing unavailable。
- **OTel**：本适配器不声明 tracing 面——`show --execution` 时间注释显示 timing unavailable，`show --timing` 不挂 OTel 子树。
