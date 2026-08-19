# DeepSeek Harness Cost

`dsh --profile headless` 当前只输出最终 assistant 文本，不输出 token、request 或 provider-observed cost。
因此 Adapter 不构造 `Usage`，也不写入 `Usage.costUSD`。
