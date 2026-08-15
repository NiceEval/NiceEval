# Bub · 用量与成本口径

token 用量从 tape 的 `run` 事件 `payload.data.usage`(Chat Completions 形状)累加。
原生口径**含子集**:`prompt_tokens` 含缓存命中,`prompt_tokens_details.cached_tokens` 是子集。
落 [Record · Usage](../../../record/architecture.md) 前按恒互斥契约归一:`inputTokens = prompt_tokens − cached_tokens`(不小于 0)。

`usage.cost` 是网关 provider / adapter observed USD 计费，累加落 `Usage.costUSD`。字段缺席时 adapter 省略成本；它不以
token 或价格表推导 `Usage.costUSD`。
