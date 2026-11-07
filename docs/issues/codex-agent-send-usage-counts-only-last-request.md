# 官方 codexAgent 一轮 send 只记录最后一次模型请求的用量，却标为 complete

## 当前公开观察

官方 `codexAgent()` 跑一轮包含多次工具调用的 send 后，公开 `attempt.usage` 只记录 1 次模型请求，token 数也只像单次请求的规模，同时把这份 usage 标为 `complete`。

NiceEval-Eval 的 Attempt `@1RC9MQT1N4GSM`（Run `0fbe1de3-6978-4541-81a3-0c014a54f703`，niceeval 0.19.0 候选，外层 `0.19.1-canary.104`）是一次单轮 Codex 会话：

- `attempt.trace` 显示本轮有 8 次命令执行（`exited` 8 条），因此至少需要 9 次模型请求；墙钟时间约 3 分钟。
- `attempt.usage` 却只有：`request` observation 1 条，`input` 1610，`output` 415，`cache-read` 38784；`usage.state = complete`，`totals.inputTokens.state = available`。

`cache-read` 38784 + `input` 1610 正好是一个约 40k token 上下文的单次请求，而不是 9 次以上请求的合计。

## 期望

- 一轮 send 的 application usage 应覆盖该轮全部模型请求的 token 与请求数。
- 如果 Adapter 无法得到全部请求，应把 usage 标成 partial 或 unavailable，不能把少采的数据标成 complete。

## 影响

所有使用 `codexAgent()` 的下游，token、请求数和由此推出的成本都会被严重低估，而且 `complete` 状态会让读者以为数据可信。比较不同文档版本或模型的开销时，结论会因此出错。

## 公开入口与复查

在拥有该记录的项目中：

```sh
pnpm --silent exec niceeval query run --request - <<'JSON'
{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.usage","locator":"@1RC9MQT1N4GSM"}}
JSON
pnpm --silent exec niceeval query run --request - <<'JSON'
{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.trace","locator":"@1RC9MQT1N4GSM"}}
JSON
```

独立复现：用官方 `codexAgent()` 发送一条至少需要两次 shell 工具调用的任务，读取该 Attempt 的 `attempt.usage`，request 数仍为 1。

## 范围与查重

这和 #295 不同。#295 讲的是缺少逐次物理调用的身份与成本证据（enhancement）；本问题是现有轮级合计本身少算，且被标成 complete（defect）。它也不同于 #292（exp --json 把完整 usage 汇总成零）。

建议分类：bug / area:adapter / needs-triage。

## 环境与来源

- Source repository: NiceEval/NiceEval-Eval（本地 dogfood）
- 来源：2026-10-29 只读公开 Query 复查 2026-10-26 的真实 harness 运行。
- Linux、Node v24、pnpm 11.12.0、官方 codexAgent、OpenSandbox/Kata。
- 不包含凭据、私有端点或原始对话。
