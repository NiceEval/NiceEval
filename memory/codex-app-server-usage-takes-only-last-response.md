# codexAgent 把 app-server 的 tokenUsage.last 当成整轮用量，多请求 send 只记最后一次

## 现象

官方 `codexAgent()` 一轮 send 内有多次工具调用（因而有多次模型请求）时，公开 `attempt.usage` 只有 1 个 request observation，token 只相当于最后一次请求，且 `usage.state = complete`。观察与公开复查见 Issue draft `docs/issues/codex-agent-send-usage-counts-only-last-request.md`。

## 根因

`packages/niceeval/src/agents/codex-app-server.ts` 的 `appServerUsage()` 从后往前找到最后一条 `thread/tokenUsage/updated`，只读取它的 `tokenUsage.last`，并固定 `requests: 1`。旁边注释认为 "`last` is already the current turn's total"。

这个前提是错的。Codex app-server v2 的 `ThreadTokenUsage = { total, last, modelContextWindow }`（codex-cli 0.165.0 `app-server generate-ts` 生成的 `v2/ThreadTokenUsage.ts`）对应 codex-rs 的 `TokenUsageInfo { total_token_usage, last_token_usage }`：每次模型响应完成后，`last` 被替换为该次响应的用量，`total` 在线程级累加。因此 `last` 是最近一次模型请求的用量，`total` 是整个线程的累计值，两者都不是"当前 turn 的合计"。

佐证：下游 Attempt `@1RC9MQT1N4GSM` 一轮内 8 次命令执行，记录的 input 1610 + cache-read 38784 恰好是一个约 40k 上下文的单次请求规模。

现有测试没有覆盖：`e2e/adapter/codex-cli` 的 `usage` Eval 只用单次请求的问答，并且只断言 token 大于 0，单请求与多请求无法区分。

## 修复方向

在 send 窗口（已按 threadId/turnId 过滤的 frames）内，按顺序遍历 `thread/tokenUsage/updated`：`total.totalTokens` 相对上一条严格增长时，视为一次新的模型响应，累加该条的 `last`，并把 requests 计数加一；`total` 未变的重复通知不重复计入。HITL 的 waiting/resume 窗口各自独立计算，不跨窗口重复。

## 验收

在 `e2e/adapter/codex-cli` 的真实 owner 中，让一轮 send 必须经过至少两次工具调用，再断言该轮 `usage.requests` 大于 1。旧候选红、修复后绿。
