# langgraph 仓库

仓库 ID `langgraph`，group `sdk`。被测应用是仓库自带的 LangGraph 图（含工具节点、interrupt 节点与 subgraph），自选 transport 部署，adapter 用官方事件流转换器 `fromLangGraphEvents()` 接入（契约见 [LangGraph 契约页](../../../feature/adapters/sdk/langgraph/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| 工具调用 | `tools` channel 的 started / finished / error 按 tool call ID 配对进入标准事件流；反例断言未挂载的工具 `notCalledTool` |
| HITL interrupt | interrupt 产生 `input.requested`，adapter 把 `input.responses` 翻译成 `Command(resume=...)` 后恢复，恢复轮出现对应结果 |
| subagent 层级 | `namespace` 中的 subgraph 归一为 subagent 层级事件 |
| 事件顺序与生命周期 | 事件顺序遵循协议 `seq`；lifecycle 的 completed / failed / interrupted 如实归一 |
| 会话与 usage | `thread_id` 作为 `ctx.session.id` 续接，第二轮能引用首轮事实；message finish 上的 usage 进入 `Turn` |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点与 subagent 层级，时间注释显示 timing unavailable。
- **OTel**：本适配器不声明 tracing 面，验收脚本经 `openResults()` 断言 attempt 不产生 trace。
