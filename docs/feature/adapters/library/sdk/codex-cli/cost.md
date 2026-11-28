# Codex CLI · 用量与成本口径

`codexAgent()` 使用 Codex 0.171 的 app-server v2。Adapter 按原生 thread、turn 和 send 窗口读取 `thread/tokenUsage/updated`。
`tokenUsage.total` 是 thread 的累计用量。`tokenUsage.last` 是最近一次有用量的模型响应。
Adapter 合计窗口内累计值递增的响应，跳过累计值相同的重复通知。

每个响应的 `inputTokens` 包含缓存命中，`cachedInputTokens` 是命中的子集。
Adapter 从输入总量扣掉命中的 token，并将命中量写为 `cacheReadTokens`，使 [Record 用量](../../../../run/architecture/README.md) 中的桶互斥。
`reasoningOutputTokens` 已包含在输出总量里。`reasoningTokens` 单列用于展示。协议缺少缓存写入计量，`cacheCreationTokens` 缺席。

原生重连的失败传输可能缺少用量通知。收到 `error` 且 `willRetry: true` 时，Adapter 保留已观察的用量，并标记 `partial`，原因是 `codex-native-retry-usage-not-reported`。
没有重连且未收到用量时，Turn 用量标为 `unavailable`，原因是 `codex-token-usage-not-reported`。

app-server v2 的用量通知包含 thread ID、turn ID、累计值、最近响应和上下文窗口大小。协议缺少物理传输 ID 及逐次请求的失败、取消、重试关联和金额凭据。
`attempt.usage` 使用 `reported-sends` 口径。逐调用模型分组显示 `unavailable`，原因是 `physical-call-identity-not-recorded`。
Adapter 省略 `Usage.costUSD`，没有金额凭据的逐调用成本保持未知。
