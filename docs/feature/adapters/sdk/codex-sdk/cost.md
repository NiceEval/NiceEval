# Codex SDK · 用量与成本口径

token 用量从 `thread.runStreamed()` 的 `turn.completed` 事件逐轮累加。
协议口径与 [Codex CLI](../codex-cli/cost.md) 同源(codex-rs `TokenUsage`):`input_tokens` 含缓存命中,`cached_input_tokens` 是子集。
落 [Record · Usage](../../../run/architecture.md) 前按恒互斥契约归一:`inputTokens = input_tokens − cached_input_tokens`(不小于 0)。
`reasoning_output_tokens` 只在该轮真的带回时累进 `reasoningTokens`。

本 adapter 没有 provider / adapter observed 成本通道，因此省略 `Usage.costUSD`。它不在 adapter 内以 token 或价格表推导成本。
