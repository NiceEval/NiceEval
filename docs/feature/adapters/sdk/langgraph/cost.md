# LangGraph · 用量与成本口径

token 用量从 message finish 上的 LangChain `usage_metadata` 逐次累加。
LangChain 的归一化口径是**含明细**:`input_tokens` 是含缓存读写的输入总量,`input_token_details.cache_read` / `.cache_creation` 是其中的明细。
落 [Record · Usage](../../../run/architecture.md) 前按恒互斥契约归一:`inputTokens = input_tokens − cache_read − cache_creation`(不小于 0),明细各自落 `cacheReadTokens` / `cacheCreationTokens`。
`output_token_details.reasoning` 单列进 `reasoningTokens`。

本 adapter 没有 provider / adapter observed 成本通道，因此省略 `Usage.costUSD`。它不在 adapter 内以 token 或价格表推导成本。
