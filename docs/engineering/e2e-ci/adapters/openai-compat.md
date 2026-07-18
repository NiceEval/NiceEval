# openai-compat 仓库

仓库 ID `openai-compat`，group `sdk`。被测对象是 [OpenAI 兼容契约页](../../../feature/adapters/sdk/openai-compat/README.md)的两个结果转换器：`fromChatCompletion` 与 `fromResponses`。仓库的 adapter 对一个真实 OpenAI 兼容网关分别发 Chat Completions 与 Responses 请求——转换器接受结构化 `*Like` 形状，E2E 用真实网关证明这两种协议形状在线上确实长这样。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| Chat Completions 工具调用 | `tool_calls` 变成 `action.called`，`content` 变成 `message`，usage 到位（含 cached tokens） |
| Responses 工具调用 | `function_call` 逐项进入 `action.called`，`output_text` 变成 `message` |
| Responses 负断言 | Responses 的 `output` 记录本轮全部决定，`notCalledTool` 反例可信且通过 |

Chat Completions 不承诺「响应 = 完整过程」，负断言只当「没看到」——这条证据完整性差异是契约本身，本仓库不为 Chat Completions 设负断言 Eval。

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点，时间注释显示 timing unavailable。
- **OTel**：两个转换器没有 tracing 面，验收脚本经 `openResults()` 断言 attempt 不产生 trace。
