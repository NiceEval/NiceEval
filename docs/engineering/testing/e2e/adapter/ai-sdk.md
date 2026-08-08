# ai-sdk 仓库

Repo ID 是 `adapter/ai-sdk`；manifest 声明 `areas: ["adapter"]`、live lanes 与 external network。
被测应用是仓库自带的 AI SDK 应用：一个暴露 UI Message Stream 的`useChat` 后端 HTTP 服务——涵盖[AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)声明的官方 HTTP Agent 工厂`uiMessageStreamAgent`。
应用接入官方 `@ai-sdk/otel`集成，把 span 发到 niceeval 固定端口收的 OTLP 接收器，同时承担矩阵中 direct-agent telemetry 路径的证明。

## 被测面

- `uiMessageStreamAgent(options)`：SSE reducer、全量历史重建、tool approval 改写重发。

## Eval 闭环

一种协议行为一个 Eval（预算见[域总则](README.md)）：

| 协议行为                   | Eval 断言（只读事件流）                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 共享断言契约 | 普通对话以 `usedNoTools` / `notCalledTool` 证明零工具；`get_weather` 真实调用分别在 turn、session 与 `t` scope 求值；coding 任务经应用的真实文件工具（`file_write` / `file_edit` / `shell`）枚举 `ToolMatch` 的 input / count / output / status。Direct Agent 不声明 Sandbox：`sandboxUnavailable: true` 时契约只跳过 `t.sandbox` 专属段，Sandbox 4 个方法由六个 coding adapters 的共享 Eval 证明 |
| UI Message Stream 工具调用 | 工具以**不带命名空间的工具名**出现在 `operation.started`，并按 operation ID 与 `operation.finished` 配对；反例断言未提供的工具 `notCalledTool`        |
| HITL 审批                  | approval part 产生 `input.requested`；批准后经改写重发恢复，恢复轮出现对应 `operation.finished`；拒绝路径产生被拒状态，不产生工具结果 |
| 会话                       | 全量历史重建下，第二轮能引用首轮事实                                                                                             |

## 仓库验收

- `e2e.json` 声明 `harness.adapterAssertions: true`；`evals/assertion-profile.ts` 只保存 AI SDK 应用的真实提示词、工具名和 marker。根 runner 在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。
- 共享契约的 coding 节由应用侧的文件工具承担：`src/backend/tools.ts` 的 `file_write` / `file_edit` / `shell` 在模块内内存文件表上执行（不落盘）。事件帧来自真实工具执行的返回结果经协议路径归一，不是伪造帧。
- 本仓库是被测对象 `uiMessageStreamAgent` 的 **Direct Agent**，核心链接契约不允许声明 Sandbox，profile 因此声明 `sandboxUnavailable: true`：
  - 契约的 `tool-match-and-sandbox` 仍对其真实工具事件执行完整 `ToolMatch`，只跳过 `t.sandbox` 专属段。
  - Sandbox 的 4 个方法（`fileChanged` / `fileDeleted` / `notInDiff` / `file` 等）由六个真实 Sandbox coding adapters 的共享 Eval 证明，本仓库不伪造变更分类账。
- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。契约在 profile 声明 `usageUnavailable: true` 时对 `maxTokens` / `maxCost` 走 optional 折叠，不把诚实缺口判成 errored。
- usage 非空这条机制事实由其它 transcript 类 Repo 承担。
- `ci` Experiment 一次选中全部 `assertion-contract/*` 与原生三条 Eval；原生验收脚本的 `EXPECTED_EVALS` 同时列全共享契约 ID 与 AI SDK 特有 Eval ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现不带命名空间的工具名调用节点（含共享契约的 `file_write` / `file_edit` / `shell` 节点与入参路径），节点带 span 时间注释。
- **OTel**：被测应用接入官方 `@ai-sdk/otel` 集成（`src/backend/otel.ts`），span 发到 `niceeval.config.ts` 的 `telemetry.port` 固定端口。执行树的时间注释就是写入成立的展示证明；本仓库承担矩阵中 direct-agent telemetry 路径的证明。
  `show --timing` 的 per-turn OTel 子树必须与事件调用靠显式 correlation 对齐；断裂按协议回归判红。
  OTel 只生成 trace，不成为事件出处；判分断言仍只读事件流。
