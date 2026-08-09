# local-protocol 仓库

Repo ID 是 `adapter/local-protocol`；manifest 声明 `areas: ["adapter"]`、PR 与 live lanes，host 执行、无外部网络、无密钥。
被测对象是 `uiMessageStreamAgent()`（官方工厂对应的稳定协议端）对着**签入的本地 UI Message Stream HTTP fixture** 的完整生命周期：transport、断流 / 超时 / HTTP 错误阶段与 cleanup（契约见 [E2E 总纲](../README.md#adapter) 与 [AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| transport | canned SSE 完整往返归约为 assistant message，公开 execution 投影含 fixture 文案 |
| 断流 | 半截 SSE 后 destroy socket → send 以可行动诊断失败在公开阶段 |
| 超时 | 挂起 body + 短 experiment.timeoutMs → send 生命周期错误 |
| HTTP 错误 | HTTP 500 → send 失败并带可行动诊断 |

## 仓库验收

- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。
- 原生验收脚本列全 transport、断流、超时与 HTTP 错误 Eval ID；逐 Eval 经公开 readback 核对 verdict 与失败阶段，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库全部协议 Eval 与 verdict；transport attempt 的 `show --execution` 显示 fixture 文案。
- **OTel**：本地 fixture 不接 OTel，执行树显示 timing unavailable；事件流断言照常通过。
