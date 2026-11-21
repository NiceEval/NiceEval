# Antigravity CLI · 用量与成本口径

token 用量来自 `step_update` 中 `agent_response` 步骤携带的 `usage`。每个带 usage 的 `agent_response` 步骤是一次模型请求，`requests` 按它计数；不能用 `result.num_turns` 代替。

原生桶：`input_tokens`、`output_tokens`、`cache_read_tokens` 相互独立，`total_tokens` 等于 input 加 output，不含缓存读。三者如实转发到恒互斥 Usage 的 input、output、cacheRead 桶，不做扣减。
`thinking_tokens` 与 output 的包含关系尚无实测证据，不写入任何 Usage 桶。原生没有缓存写入桶。

`result.usage` 是整个会话的累计值，跨轮、跨进程续接都会累加，不能直接当作本轮用量。本轮用量只汇总本轮的逐步骤 usage；不把逐步骤值与 `result.usage` 相加。
本轮有模型步骤缺少 usage 时，Usage 标为不完整，不垫 0；整轮没有任何 usage 时省略 `Usage`。

Antigravity CLI 不报告费用，`Usage.costUSD` 始终为空，成本只能由 PricingProfile 推算。
