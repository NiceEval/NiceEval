# OpenCode · 用量与成本口径

token 用量从 `run --format json` 的 `step_finish`（或等价摘要事件）与 `opencode export` 侧写里的 usage 字段聚合。

字段认 `input` / `output` / `cacheRead` / `cacheWrite` 与 snake_case 变体。
原生桶若已互斥，如实转发，不做扣减；若 `input`/`prompt_tokens` 含缓存命中，落互斥桶前先扣掉 cache 部分（见 [Record · Usage](../../../record/architecture.md#usage)）。

有实测 `cost` / `costUSD` 时累加进 `usage.costUSD`；缺席时改用价格表估算（见 [Observability · 用量与成本](../../../../observability.md#用量与成本token--计费)）。

`requests` 计带回 usage 的真实请求数；整轮无 usage 时省略 `Usage`，不垫 0。
