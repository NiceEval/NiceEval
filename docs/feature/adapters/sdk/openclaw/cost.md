# OpenClaw · 用量与成本口径

token 用量从 session transcript(或 `agent --json` 结果封包回退)的 usage 字段读取,认 pi 系简写(`input` / `output` / `cacheRead` / `cacheWrite`)与 snake_case 变体。pi 系口径原生互斥——`input` 不含缓存命中,cacheRead / cacheWrite 独立计量——与 [Record · Usage](../../../run/architecture.md) 的恒互斥契约同口径,如实转发,不做扣减(字段事实以真实 CLI 与 transcript fixture 固定为准,见 [README](README.md))。

OpenClaw transcript 的 `cost`（或 `cost.total`）来自 session-derived catalog，是 estimate，不是 provider / adapter observed 成本，绝不写入
`Usage.costUSD`。转换器不在此处补做成本计算。
