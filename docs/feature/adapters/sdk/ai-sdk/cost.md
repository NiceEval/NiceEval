# AI SDK · 用量与成本口径

token 用量从 `turnFromAiSdk` 的聚合 usage 读取,兼容多代字段名。
AI SDK 的归一化口径是**含明细**:`inputTokens`(旧代 `promptTokens`)是含缓存部分的输入总量,`cachedInputTokens`(v7 起 `inputTokenDetails.cacheReadTokens` / `.cacheWriteTokens`)是其中的缓存明细。
落 [Record · Usage](../../../record/architecture.md#usage) 前按恒互斥契约归一:`inputTokens` 扣掉在场的缓存明细(cache read 与 cache write 都算,结果不小于 0),明细各自落 `cacheReadTokens` / `cacheCreationTokens`。

转换器本身不产成本:走 AI Gateway 等带实测计费的 transport 时,由调用方的 `defineDirectAgent` 显式落 `Turn.usage.costUSD`(实测优先于估算,见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费));否则 `$` 由价格表估算。
