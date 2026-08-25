# ai-sdk 仓库

## adapter-ai-sdk-live-compatibility

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/ai-sdk`；manifest 声明 `areas: ["adapter"]`、live lanes 与 external network。
被测应用是仓库自带的 AI SDK 应用：一个暴露 UI Message Stream 的`useChat` 后端 HTTP 服务——涵盖[AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)声明的官方 HTTP Agent 工厂`uiMessageStreamAgent`。
应用接入官方 `@ai-sdk/otel`集成。该签入场景在 `src/topology.ts` 固定 HTTP 与 OTLP 拓扑，应用把 span 发到 niceeval 固定端口收的 OTLP 接收器，同时承担矩阵中 direct-agent telemetry 路径的证明；内部 endpoint 不从子进程变量读取。

## 被测面

- `uiMessageStreamAgent(options)`：SSE reducer、全量历史重建、tool approval 改写重发；被测 endpoint
  对注册的 `get_weather` / `calculate` 逐笔提供 `notCommandProjection()`，未知工具保持未分类。

## Eval 闭环

一种协议行为一个 Eval（预算见[域总则](README.md)）：

| 协议行为                   | Eval 断言（只读事件流）                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UI Message Stream 工具调用 | 工具以**不带命名空间的工具名**出现在 `operation.started`，并按 operation ID 与 `operation.finished` 配对 |
| HITL 审批                  | approval part 产生 `operation.started` + `input.requested`，工具在该轮是 `pending`；批准后经改写重发恢复，恢复轮出现对应 `operation.finished`；拒绝路径产生被拒状态，不产生工具结果 |
| 会话                       | 全量历史重建下，第二轮能引用首轮事实                                                                                             |

## 仓库验收

- 本仓库是被测对象 `uiMessageStreamAgent` 的 Direct Agent，核心链接契约不允许声明 Sandbox；仓库不为测试伪造变更分类账。
- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。
- usage 非空这条机制事实由其它 transcript 类 Repo 承担。
- `ci` Experiment 选中本仓库的工具、HITL 与会话 Eval；原生验收脚本列全这些协议 Eval ID，防止少发现/少运行后假绿。
- `attempts: 1` 且没有测试级 retry；只声明实际使用的 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，不要求 Judge secret。
- 外层只从 Testkit `expResult()` 读取精确终态：`passed: 3`、`failed: 0`、`errored: 0`、`completion: "complete"`。工具、approval、会话与 usage 的判分只在各 Eval 的 `Turn.events` 中完成。
- HTTP backend 与 `niceeval exp` 分别由 Testkit 独立进程组拥有，Journey 结束时都完成最终无 orphan cleanup。
- **CLI 读回**：固定 `attempt.trace` request 返回不带命名空间的工具名调用及入参；人类可用 `view @locator` 深读。通用 query / View 矩阵不由本 Repo 重复验收。
- **OTel 写入**：被测应用接入官方 `@ai-sdk/otel` 集成（`src/backend/otel.ts`）。span 按 `src/topology.ts` 的固定 endpoint 发到 `niceeval.config.ts` 的 `telemetry.port`。
- **OTel 生命周期**：UI stream 关闭 HTTP response 前显式 `forceFlush()`，进程终结时 `shutdown()` provider。验收不用固定延时竞速 BatchSpanProcessor。
- **OTel 观察边界**：当前公开 Record / `query` 不能把 mapper 与单个 Adapter 明确归因，因此本 Repo 不声称 mapper-specific OTel 已被验收，也不以日志、私有结果或通用 timing 代替。
- OTel 不成为事件出处。判分断言只读事件流；通用 Runner timing 由 [`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回。
