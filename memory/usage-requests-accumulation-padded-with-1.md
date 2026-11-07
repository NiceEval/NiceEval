# 已修:SessionManager.accumulateUsage 曾把缺失的 requests/cache token 用 1/0 凑数

**现象**:落盘 `result.json` 的 `usage.requests` 经常是 `1`,即使该 attempt 内部真实发生了几十次工具调用 / 模型请求(如 memory-evals-three-way-result 与 show-scope-slice-json-ruling 记录的「21 次工具调用的 codex session 落盘 `requests: 1`」)。跨 attempt 对比 usage 时,转录解析型 adapter(codex/claude-code/bub/openclaw,只在 attempt 末尾解析一次完整 transcript)的 `requests` 几乎恒为 `1`,而 SDK 流式 adapter(ai-sdk/langgraph/sdk-streams)的 `requests` 是真实计数,两类 producer 的同一字段口径完全不可比。

**根因**:`src/context/session.ts` 的 `accumulateUsage(acc, add)` 在每次 `t.send()` 产生的 `turn.usage` 缺 `requests` 时用 `add.requests ?? 1` 兜底——把"这一轮没报请求数"悄悄当成"这一轮恰好发生了 1 次请求"。转录解析型 adapter 的 `Turn.usage` 天然不含每轮请求数(见 `src/o11y/parsers/*.ts` 已经正确地只在 `requests > 0` 时才设置该字段),于是每次 `t.send()` 都被计成 1,`requests` 实际变成了"轮数"的误代理,不是真请求数。同一函数里 `cacheReadTokens`/`cacheWriteTokens` 的初值(`{ ..., cacheReadTokens: 0 }`)与累加(`(add.cacheReadTokens ?? 0)`)有同样的问题:不支持 prompt cache 的 adapter 会被垫成 `0`,与"省略表示该 agent 不上报此项"的字段契约(`src/o11y/types.ts` 的 `Usage` 注释,`docs/feature/results/architecture.md`「Usage」)矛盾。

**修法**:`accumulateUsage` 改为只在某一轮真的带回该值时才累加(`if (add.requests !== undefined) acc.requests = (acc.requests ?? 0) + add.requests;`,`cacheReadTokens`/`cacheWriteTokens` 同理);`RunSession`/`SessionManager` 的 `usage` 初值去掉 `cacheReadTokens: 0`/`requests: 0`,只保留 Usage 的必填字段 `inputTokens`/`outputTokens`。落点 `src/context/session.ts`。所有下游消费方(`report/components/attempt-detail`、`runner/reporters/braintrust.ts` 等)已经用 `!== undefined` 判断这几个字段,不受影响。

**适用场景**:任何新增/修改 turn-level usage 累加逻辑时,不要用 `?? 1` 或 `?? 0` 兜底可选的计数类字段——协议没提供就该让累加结果继续缺席,不能拿"这一步大概率发生过一次"去凑一个看似合理的数字。
