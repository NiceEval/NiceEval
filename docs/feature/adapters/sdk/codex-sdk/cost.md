# Codex SDK · 用量与成本口径

token 用量从 `thread.runStreamed()` 的 `turn.completed` 事件逐轮累加。协议口径与 [Codex CLI](../codex-cli/cost.md) 同源(codex-rs `TokenUsage`):`input_tokens` 含缓存命中,`cached_input_tokens` 是子集。落 [Results · Usage](../../../record/architecture.md#usage) 前按恒互斥契约归一:`inputTokens = input_tokens − cached_input_tokens`(不小于 0)。`reasoning_output_tokens` 只在该轮真的带回时累进 `reasoningTokens`。

本 adapter 没有实测成本通道:`$` 由价格表估算(见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
