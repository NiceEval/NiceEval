# Claude Code · 用量与成本口径

token 用量从 transcript JSONL 的逐请求 `usage` 聚合。
Anthropic 协议原生就是互斥桶——`input_tokens` 不含缓存命中,`cache_read_input_tokens` / `cache_creation_input_tokens` 是独立计量——与 [Record · Usage](../../../run/architecture.md) 的恒互斥契约同口径,如实转发,不做扣减。
`cache_creation` 的 ttl 明细(`ephemeral_5m` / `ephemeral_1h`)在顶层字段存在时已是二者之和,不重复相加。

本 adapter 没有 provider / adapter observed 成本通道，因此省略 `Usage.costUSD`。它不在 adapter 内以 token 或价格表推导成本；Runner estimate
与 Inspection Profile 投影保持独立。

`requests` 计带回 usage 的真实请求数,transcript 无 usage 时整个 `Usage` 省略,不垫 0。
