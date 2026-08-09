# ai-sdk 仓库

Repo ID 是 `adapter/ai-sdk`；manifest 声明 `areas: ["adapter"]`、live lanes 与 external network。
被测应用是仓库自带的 AI SDK 应用：一个暴露 UI Message Stream 的`useChat` 后端 HTTP 服务——涵盖[AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)声明的官方 HTTP Agent 工厂`uiMessageStreamAgent`。
应用接入官方 `@ai-sdk/otel`集成。该签入场景在 `src/topology.ts` 固定 HTTP 与 OTLP 拓扑，应用把 span 发到 niceeval 固定端口收的 OTLP 接收器，同时承担矩阵中 direct-agent telemetry 路径的证明；内部 endpoint 不从子进程变量读取。

## 被测面

- `uiMessageStreamAgent(options)`：SSE reducer、全量历史重建、tool approval 改写重发。

## Eval 闭环

一种协议行为一个 Eval（预算见[域总则](README.md)）：

| 协议行为                   | Eval 断言（只读事件流）                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UI Message Stream 工具调用 | 工具以**不带命名空间的工具名**出现在 `operation.started`，并按 operation ID 与 `operation.finished` 配对；反例断言未提供的工具 `notCalledTool`        |
| HITL 审批                  | approval part 产生 `input.requested`；批准后经改写重发恢复，恢复轮出现对应 `operation.finished`；拒绝路径产生被拒状态，不产生工具结果 |
| 会话                       | 全量历史重建下，第二轮能引用首轮事实                                                                                             |

## 仓库验收

- 本仓库是被测对象 `uiMessageStreamAgent` 的 Direct Agent，核心链接契约不允许声明 Sandbox；仓库不为测试伪造变更分类账。
- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。
- usage 非空这条机制事实由其它 transcript 类 Repo 承担。
- `ci` Experiment 选中本仓库的工具、HITL 与会话 Eval；原生验收脚本列全这些协议 Eval ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现不带命名空间的工具名调用节点与入参，节点带 span 时间注释。
- **OTel**：被测应用接入官方 `@ai-sdk/otel` 集成（`src/backend/otel.ts`），span 按 `src/topology.ts` 的场景内固定 endpoint 发到 `niceeval.config.ts` 的 `telemetry.port`。执行树的时间注释就是写入成立的展示证明；本仓库承担矩阵中 direct-agent telemetry 路径的证明。
  `show --timing` 的 per-turn OTel 子树必须与事件调用靠显式 correlation 对齐；断裂按协议回归判红。
  OTel 只生成 trace，不成为事件出处；判分断言仍只读事件流。
