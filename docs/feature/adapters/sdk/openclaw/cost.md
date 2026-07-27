# OpenClaw · 用量与成本口径

token 用量从 session transcript(或 `agent --json` 结果封包兜底)的 usage 字段读取,认 pi 系简写(`input` / `output` / `cacheRead` / `cacheWrite`)与 snake_case 变体。pi 系口径原生互斥——`input` 不含缓存命中,cacheRead / cacheWrite 独立计量——与 [Record · Usage](../../../record/architecture.md#usage) 的恒互斥契约同口径,如实转发,不做扣减(字段事实以真实 CLI 与 transcript fixture 固定为准,见 [README](README.md))。

usage 里的 `cost`(或 `cost.total`)是实测计费,累加落 `usage.costUSD`——消费方优先它,价格表估算只在实测缺席时兜底(见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费))。
