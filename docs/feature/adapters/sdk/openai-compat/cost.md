# OpenAI-compat · 用量与成本口径

两个转换器各认自家协议的 usage 形状,原生口径都是**含子集**,落 [Record · Usage](../../../record/architecture.md#usage) 前都按恒互斥契约扣减(结果不小于 0):

- **Chat Completions**:`prompt_tokens` 含缓存命中,`prompt_tokens_details.cached_tokens` 是子集 → `inputTokens = prompt_tokens − cached_tokens`;`completion_tokens_details.reasoning_tokens` 单列进 `reasoningTokens`。
- **Responses**:`input_tokens` 含缓存命中,`input_tokens_details.cached_tokens` 是子集 → 同样扣减;`output_tokens_details.reasoning_tokens` 单列。

OpenAI 协议没有缓存写入计量,`cacheCreationTokens` 恒缺席。

转换器本身不产成本:走这两种协议形状的网关若在响应里带实测计费,由调用方的 `defineDirectAgent` 显式落进 `Turn.usage.costUSD`(实测优先于估算,见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费));否则 `$` 由价格表估算。
