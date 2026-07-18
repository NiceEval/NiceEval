# ai-sdk 仓库

仓库 ID `ai-sdk`，group `sdk`。被测应用是仓库自带的 AI SDK 应用：一个暴露 UI Message Stream 的 `useChat` 后端 HTTP 服务，外加一个进程内 `generateText` 循环——覆盖 [AI SDK 契约页](../../../feature/adapters/sdk/ai-sdk/README.md)声明的全部三种接入面。

## 被测面

- `uiMessageStreamAgent(options)`：SSE reducer、全量历史重放、tool approval 改写重发。
- `aiSdkAgent({ generate })`：进程内循环的无状态历史与 approval 恢复。
- `fromAiSdk(result)`：`generateText` / `streamText` 结果形状到 `Turn` 的零映射。

## Eval 闭环

一种协议行为一个 Eval（预算见[域总则](README.md)）：

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| UI Message Stream 工具调用 | 工具以**裸工具名**出现在 `action.called`，并按 tool call ID 与 `action.result` 配对；反例断言未提供的工具 `notCalledTool` |
| HITL 审批 | approval part 产生 `input.requested`；批准后经改写重发恢复，恢复轮出现对应 `action.result`；拒绝路径产生被拒状态，不产生工具结果 |
| 会话 | 全量历史重放下，第二轮能引用首轮事实 |
| 进程内循环 | `aiSdkAgent` 走通同一工具 + 审批路径，证明两种 transport 事件词汇一致 |
| 结果零映射 | `fromAiSdk` 构造的 `Turn` 带 step content、tool call 配对与聚合 usage |

## 仓库验收

- 验收脚本核对 CLI 退出码、实际运行的 Eval 集合与逐轮 usage 非空。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现裸工具名调用节点，节点带 span 时间注释。
- **OTel**：被测应用接入 `aiSdkOtel()`（`niceeval/adapter/otel`），执行树的时间注释就是记录成立的展示证明；`openResults()` 抽查 span 经显式 correlation 与工具事件对应——本仓库承担矩阵中 remote-agent telemetry 路径的证明。OTel 只生成 trace，不成为事件来源；判分断言仍只读事件流。
