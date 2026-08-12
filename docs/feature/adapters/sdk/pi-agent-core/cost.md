# pi-agent-core · 用量与成本口径

token 用量从 `createPiAgentEventStream` 的事件 usage(`input` / `output` / `cacheRead` / `cacheWrite`)逐轮累加。
pi 口径原生互斥——`input` 不含缓存命中,cacheRead / cacheWrite 独立计量——与 [Record · Usage](../../../record/architecture.md) 的恒互斥契约同口径,如实转发,不做扣减。

`cost.total` 是 pi 自算的分项计费,累加落 `usage.costUSD`——消费方优先它,实测缺席时才使用价格表估算(见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
