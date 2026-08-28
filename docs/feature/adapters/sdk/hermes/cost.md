# Hermes Agent · 用量与成本口径

token 用量优先从 `state.db` / sessions export 的 session 级计数读取：`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`。

这些桶与 [Record · Usage](../../../run/architecture.md) 的恒互斥契约同口径时如实转发；若上游把缓存算进 input，落桶前先扣减。

只有 `actual_cost_usd` 是 provider observed USD 成本，才累加进 `Usage.costUSD`。`estimated_cost_usd` 是 estimate，必须忽略，绝不写入
`Usage.costUSD`；转换器也不在 adapter 内计算或补入任何价格表成本。

`requests` 认 `api_call_count`（有则用之）；都没有且无逐消息 usage 时省略 `Usage`，不垫 0。
