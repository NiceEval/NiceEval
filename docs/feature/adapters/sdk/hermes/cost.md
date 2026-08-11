# Hermes Agent · 用量与成本口径

token 用量优先从 `state.db` / sessions export 的 session 级计数读取：`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`。

这些桶与 [Record · Usage](../../../record/architecture.md) 的恒互斥契约同口径时如实转发；若上游把缓存算进 input，落桶前先扣减。

成本认 `actual_cost_usd`，缺席再认 `estimated_cost_usd`，累加进 `usage.costUSD`。
两者都缺时改用价格表估算（见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费)）。

`requests` 认 `api_call_count`（有则用之）；都没有且无逐消息 usage 时省略 `Usage`，不垫 0。
