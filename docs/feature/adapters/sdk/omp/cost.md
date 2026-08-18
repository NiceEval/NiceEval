# Oh My Pi Cost

`createPiAgentEventStream()` 累加 assistant `message_end.usage` 的 input、output、cache-read 与 cache-write token，
并以每条 assistant 终帧记一次 request。pi 本地价格表算出的 cost 不是 provider-observed billing，
不写入 `Usage.costUSD`。
