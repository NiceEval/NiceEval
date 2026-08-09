# UI Message Stream 确定性协议 E2E

## adapter-local-protocol

Repo ID 是 `adapter/local-protocol`；manifest 声明 `areas: ["adapter"]`、PR 与 live lanes，host 执行、无外部网络、无密钥。
这个 Repo 不是独立官方 Adapter，被测公开入口是 `uiMessageStreamAgent()`。

签入的 UI Message Stream HTTP fixture 为同一个公开工厂提供三类输入。正常 SSE 是成功对照。
AI SDK 公共 `UIMessageChunk` 类型约束的 approval stream 证明 NiceEval 自有的 HITL 状态机。
断流、timeout 与 HTTP 非 2xx 是确定性故障。
这些输入证明 NiceEval 自己拥有的 transport、审批生命周期和错误处理；真实 AI SDK 上游的协议兼容性由
[`adapter/ai-sdk`](ai-sdk.md) 证明。
产品契约见 [AI SDK](../../../../feature/adapters/sdk/ai-sdk/README.md)，测试分工见 [E2E 总纲](../README.md#adapter)。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流与公开运行结果） |
|---|---|
| 正常 SSE | 完整帧序列归约为成功 Turn，assistant message 与公开 execution 投影包含 fixture 文案 |
| HITL approval | `approval-requested` 先产生一次 `operation.started` + `input.requested`，调用处于 pending；approve / deny resume 分别以同一 call ID 唯一结束为 completed / rejected |
| 半途断流 | 收到部分 SSE 后连接关闭，运行必须非零退出，并产生归属于本 Eval 的 send 失败 |
| timeout | 响应头完成但 body 挂起，Attempt deadline 必须中止 send，并产生 timeout 诊断 |
| HTTP 非 2xx | HTTP 500 必须使 send 失败，诊断包含 HTTP 请求或状态信息 |

正常 SSE 是三个负面场景的 control。
它先证明相同 candidate、fixture、transport 与 Adapter 接线能够成功，避免把宿主运行条件或安装错误误判成故障处理正确。

## 仓库验收

- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。
- approval fixture 的每个 outbound chunk 都满足锁定 AI SDK 导出的 `UIMessageChunk`；它不复制 reducer，也不伪造 provider 决策。
- 原生验收脚本列全正常 SSE、approval、断流、timeout 与 HTTP 错误 Eval ID；逐 Eval 经公开 readback 核对 verdict 与失败阶段，防止少发现或少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库全部协议 Eval 与 verdict；正常 SSE 与 approval attempt 的 `show --execution` 分别显示 fixture 文案，以及 completed / rejected 工具生命周期。
- **OTel**：本地 fixture 不接 OTel，执行树显示 timing unavailable；事件流断言照常通过。

## 与 live AI SDK 的边界

本 Repo 不声明真实 AI SDK 版本兼容，也不模拟 provider 工具选择、模型会话或 OTel 的完整上游形状。
它只用公共 `UIMessageChunk` 的最小 approval 序列拥有 NiceEval 自己的 pending / resume 归一；完整正面兼容性仍由
`adapter/ai-sdk` 使用真实 AI SDK 应用与 live provider 验收。
反过来，live Repo 不负责稳定制造断流、挂起与 HTTP 错误，也不接管 NiceEval 自有错误处理的可靠性。
