# OpenCode · 用量与成本口径

token 用量从 `run --format json` 的 `step_finish`（或等价摘要事件）与 `opencode export` 侧写里的 usage 字段聚合。

字段认 `input` / `output` / `cacheRead` / `cacheWrite` 与 snake_case 变体。
原生桶若已互斥，如实转发，不做扣减；若 `input`/`prompt_tokens` 含缓存命中，落互斥桶前先扣掉 cache 部分（见 [Record · Usage](../../../run/architecture.md)）。

OpenCode transcript 的 `cost` / `costUSD` 来自 models.dev/config price table，是 estimate，不是 provider / adapter observed 成本，绝不写入
`Usage.costUSD`。转换器不在此处补做成本计算。

`requests` 计带回 usage 的真实请求数；整轮无 usage 时省略 `Usage`，不垫 0。
