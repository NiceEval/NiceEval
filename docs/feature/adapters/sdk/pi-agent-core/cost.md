# pi-agent-core · 用量与成本口径

token 用量从 `createPiAgentEventStream` 的事件 usage(`input` / `output` / `cacheRead` / `cacheWrite`)逐轮累加。
pi 口径原生互斥——`input` 不含缓存命中,cacheRead / cacheWrite 独立计量——与 [Record · Usage](../../../run/architecture.md) 的恒互斥契约同口径,如实转发,不做扣减。

`u.cost.total`（事件字段有时写作 `cost.total`）是 pi 自算的分项 estimate，不是 provider / adapter observed 成本，绝不写入
`Usage.costUSD`。转换器不在此处补做成本计算。
