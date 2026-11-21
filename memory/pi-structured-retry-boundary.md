---
relations:
  - role: supports
    target: docs/feature/judge/library.md#managed-pi-transport
---

# pi 会话重试缺少结构化 HTTP 判断入口

pi coding agent 1.5.2 的公开 AgentSession API 没有 HTTP 状态或 Retry-After 重试 hook。
其私有 `_isRetryableError` 调用 `isRetryableAssistantError`，按 errorMessage 正则分类。
`Concurrency limit exceeded for account, please retry later` 不命中该正则；错误格式化还可能丢掉 HTTP 状态。
只看封存的 errorMessage 无法证明网关返回了 429。

NiceEval 将请求重试交给 pi 的 Provider 层，关闭 session 请求重试，避免层间叠加。
该层读取 SDK error 的状态与 headers，支持同一 AbortSignal 中断退避；响应流开始后的失败不会重新发送。
HTTP 状态与解析后的等待值单独封存，历史缺失值保持未知。

上游可改进之处是为 AgentSession 提供结构化的重试决策 hook，并保留错误的 HTTP 状态。
在上游没有该能力前，不覆写 pi 私有方法，也不把原始错误改成能命中正则的文案。

依据：[受管 pi 传输](../docs/feature/judge/library.md#managed-pi-transport)。
