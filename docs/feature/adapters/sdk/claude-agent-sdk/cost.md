# Claude Agent SDK · 用量与成本口径

token 用量从 SDK 消息流的 result 帧读取。
Anthropic 协议原生互斥桶(`input_tokens` 不含缓存命中,cache read / cache creation 独立计量),与 [Record · Usage](../../../run/architecture.md) 的恒互斥契约同口径,如实转发,不做扣减。

result 帧的 `total_cost_usd` 是 SDK observed USD 成本，落 `Usage.costUSD`。字段缺席时 adapter 省略成本，不用 token 或价格表推导它；Runner
estimate 与 Inspection 的显式 Profile 投影是独立路径。
