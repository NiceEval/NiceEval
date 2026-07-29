# Bub · 用量与成本口径

token 用量从 tape 的 `run` 事件 `payload.data.usage`(Chat Completions 形状)累加。原生口径**含子集**:`prompt_tokens` 含缓存命中,`prompt_tokens_details.cached_tokens` 是子集。落 [Record · Usage](../../../record/architecture.md#usage) 前按恒互斥契约归一:`inputTokens = prompt_tokens − cached_tokens`(不小于 0)。

同一 usage 对象里的 `cost` 是网关实测计费,累加落 `usage.costUSD`——消费方优先它,实测缺席时才使用价格表估算(见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
