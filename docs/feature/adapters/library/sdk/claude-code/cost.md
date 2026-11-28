# Claude Code · 用量与成本口径

token 用量从 transcript JSONL 的逐请求 `usage` 聚合。
Anthropic 协议原生就是互斥桶——`input_tokens` 不含缓存命中,`cache_read_input_tokens` / `cache_creation_input_tokens` 是独立计量——与 [Record · Usage](../../../../run/architecture/README.md) 的恒互斥契约同口径,如实转发,不做扣减。
`cache_creation` 的 ttl 明细(`ephemeral_5m` / `ephemeral_1h`)在顶层字段存在时已是二者之和,不重复相加。

本 adapter 没有 provider / adapter observed 成本通道，因此省略 `Usage.costUSD`。它不在 adapter 内以 token 或价格表推导成本；Runner estimate
与 Inspection Profile 投影保持独立。
用 `oauthToken` 走 Claude 订阅时，token 用量照常记录；Runner 按价目表得到的估算是 API 价格的折算值，订阅的实际扣费没有可读的通道。

`requests` 计带回 usage 的真实请求数,transcript 无 usage 时整个 `Usage` 省略,不垫 0。
