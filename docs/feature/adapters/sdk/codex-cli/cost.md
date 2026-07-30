# Codex CLI · 用量与成本口径

token 用量从 `codex exec --json` transcript 的逐事件 `usage`(codex-rs `TokenUsage` 形状)聚合。
协议原生口径是**含子集**:`input_tokens` 是含缓存命中的输入总量,`cached_input_tokens` 是其中命中缓存的子集。
落 [Record · Usage](../../../record/architecture.md#usage) 前按恒互斥契约归一:`inputTokens = input_tokens − cached_input_tokens`(不小于 0),`cacheReadTokens = cached_input_tokens`。
不扣减会让缓存命中同时按全价与缓存价计费两次——coding agent 会话缓存命中率常在九成以上,双计会把估算成本放大数倍。

`reasoning_output_tokens` 已含在 `output_tokens` 里,单列进 `reasoningTokens` 只为展示,不参与桶相加。
OpenAI 协议没有缓存写入计量,`cacheCreationTokens` 恒缺席。

本 adapter 没有实测成本通道:`$` 由价格表估算(见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
