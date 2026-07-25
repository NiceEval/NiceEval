# Claude Agent SDK · 用量与成本口径

token 用量从 SDK 消息流的 result 帧读取。Anthropic 协议原生互斥桶(`input_tokens` 不含缓存命中,cache read / cache creation 独立计量),与 [Results · Usage](../../../record/architecture.md#usage) 的恒互斥契约同口径,如实转发,不做扣减。

result 帧的 `total_cost_usd` 是 SDK 实测成本,落 `usage.costUSD`——消费方优先它,价格表估算只在实测缺席时兜底(通道优先级见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
