# ai-sdk 仓库

仓库 ID `ai-sdk`，group `sdk`。
被测应用是仓库自带的 AI SDK 应用：一个暴露 UI Message Stream 的`useChat` 后端 HTTP 服务——覆盖[AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)声明的官方 HTTP Agent 工厂`uiMessageStreamAgent`。
应用接入官方 `@ai-sdk/otel`集成，把 span 发到 niceeval 固定端口收的 OTLP 接收器，同时承担矩阵中 direct-agent telemetry 路径的证明。

## 被测面

- `uiMessageStreamAgent(options)`：SSE reducer、全量历史重放、tool approval 改写重发。

## Eval 闭环

一种协议行为一个 Eval（预算见[域总则](README.md)）：

| 协议行为                   | Eval 断言（只读事件流）                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UI Message Stream 工具调用 | 工具以**不带命名空间的工具名**出现在 `action.called`，并按 tool call ID 与 `action.result` 配对；反例断言未提供的工具 `notCalledTool`        |
| HITL 审批                  | approval part 产生 `input.requested`；批准后经改写重发恢复，恢复轮出现对应 `action.result`；拒绝路径产生被拒状态，不产生工具结果 |
| 会话                       | 全量历史重放下，第二轮能引用首轮事实                                                                                             |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
  usage 非空这条机制事实由 `results`仓库承担（本仓库的 UI Message Stream 协议帧不带 token 计数，属于诚实的`unavailable`，不在此断言）。
- **CLI 读回**：`show` 默认报告列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution`执行树出现不带命名空间的工具名调用节点，节点带 span 时间注释。
- **OTel**：被测应用接入官方 `@ai-sdk/otel` 集成（`src/backend/otel.ts`），span 发到`niceeval.config.ts` 的 `telemetry.port`固定端口——执行树的时间注释就是记录成立的展示证明；本仓库承担矩阵中 direct-agent telemetry 路径的证明。
  `show --timing` 的 per-turn OTel 子树是已知缺口（`memory/ai-sdk-agent-otel-timing-subtree-unlinked.md`），验收脚本非 gating。
  OTel 只生成 trace，不成为事件来源；判分断言仍只读事件流。
