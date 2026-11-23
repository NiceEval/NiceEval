# Bub · 用量与成本口径

Adapter 从 tape 的 `run` 事件累加 Republic 的 `payload.data.usage`。
`input_tokens` 包含 `cached_tokens` 和 `cache_write_tokens`。Adapter 减去两个缓存桶，得到非负的 `inputTokens`。
`output_tokens` 包含 `reasoning_tokens`。Adapter 在 [Record · Usage](../../../../run/architecture/README.md) 保留推理用量，计算输出总量时只计一次。

Republic 的 Chat Completions 客户端不会把网关的 `usage.cost` 留在 tape 中。Bub 的 reported 成本因此缺失。
有适用价目时，NiceEval 照常按 token 用量估算 `estimatedCostUSD`。
