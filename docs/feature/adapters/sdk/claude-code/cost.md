# Claude Code · 用量与成本口径

token 用量从 transcript JSONL 的逐请求 `usage` 聚合。
Anthropic 协议原生就是互斥桶——`input_tokens` 不含缓存命中,`cache_read_input_tokens` / `cache_creation_input_tokens` 是独立计量——与 [Record · Usage](../../../record/architecture.md#usage) 的恒互斥契约同口径,如实转发,不做扣减。
`cache_creation` 的 ttl 明细(`ephemeral_5m` / `ephemeral_1h`)在顶层字段存在时已是二者之和,不重复相加。

本 adapter 没有实测成本通道:`$` 由价格表估算(逐桶乘单价相加,通道优先级与价格表出处见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。

`requests` 计带回 usage 的真实请求数,transcript 无 usage 时整个 `Usage` 省略,不垫 0。
