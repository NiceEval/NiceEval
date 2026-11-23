# DeepSeek Harness Cost

Adapter 从原生 `status/step_end` 读取主 Session 各模型步骤报告的 token，用 `Turn.usage` 保存观测值。
DSH 在步骤中合计有计量的重试。任一尝试缺失计量时，DSH 省略该步骤的汇总。缺失值保持缺失。

DeepSeek Messages 的 `inputTokens`、`cacheReadTokens` 和 `cacheWriteTokens` 互斥。
Adapter 将最后一项映射为 `cacheCreationTokens`。可选桶只在所有计入步骤均报告时汇总。
用量覆盖为 partial，因为 headless 输出只投影主 Session 的模型步骤。协议未提供实际请求次数和实付美元金额。
NiceEval 可按现有价格表计算 `estimatedCostUSD`。`Usage.costUSD` 保持缺失。
