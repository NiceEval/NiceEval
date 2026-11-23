# Oh My Pi Cost

`createPiAgentEventStream()` 累加 assistant `message_end.usage` 的 input、output、cache-read 与 cache-write token，
并以每条 assistant 终帧记一次 request。用量覆盖为 `partial`。OMP 可能在冷启动时向能力未知的模型端点发出推理能力探测请求，
这些请求的用量不出现在 JSONL 流里。

只有 Provider 实际报告的费用可写入 `Usage.costUSD`。OMP 的本地价格表提供估算。
