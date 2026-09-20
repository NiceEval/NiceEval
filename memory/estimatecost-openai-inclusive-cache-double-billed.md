---
format: concord.document/v1
id: estimatecost-openai-inclusive-cache-double-billed
title: estimateCost 对 OpenAI 口径 usage 双重计费 cache read
createdAt: 2026-07-24T15:17:39+08:00
createdAtSource:
  kind: first-recorded
  path: memory/estimatecost-openai-inclusive-cache-double-billed.md
  commit: ae9102914d790ecdb70980252c2282e846faa841
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: '**修法**（2026-07-24 已修）：采用「adapter 边界归一成互斥桶」——`Usage` 契约改为三个输入侧桶恒互斥（`docs/feature/results/architecture.md#usage` 重写,`src/o11y/types.ts` TSDoc 同步）,七个 OpenAI 系生产点落 `inputTokens` 前扣掉缓存明细并夹底 0：`src/agents/sdk-streams.ts`（codex turn.completed）、`src/o11y/parsers/codex.ts`、`src/agents/openai-compat.ts`（Chat Completions + Responses）、`src/agents/ai-sdk.ts`（cacheRead+cacheWrite 都扣）、`src/agents/langgraph.ts`（cache_read+cache_creation 都扣）、`src/o11y/parsers/bub.ts`；Anthropic / pi 系原生互斥不动。`estimateCost` 公式不变（互斥下逐桶相加即正确）。报告层 `uncachedInputTokens` 派生字段整个删除（`inputTokens` 即未缓存输入,"uncached in" 标注由 face 层在 cache 桶在场时给）：`src/report/model/types.ts`、`compute.ts`、`faces.ts`、`UsageTable.tsx`、`src/show/index.ts`。各 adapter 口径逐家声明在 `docs/feature/adapters/sdk/<name>/cost.md`（10 篇新文档）。测试锁定在 `src/agents/{sdk-streams,openai-compat,ai-sdk,langgraph}.test.ts` 与 `src/o11y/parsers/{codex,bub}.test.ts`。**注意断代**：此前所有 OpenAI 系 run 的落盘 `usage.inputTokens` 是含缓存总量、`estimatedCostUSD` 虚高 ~5.5x,与新 run 对比时要按旧口径换算（uncached = input − cacheRead）。'
    proof: []
    source:
      path: memory/estimatecost-openai-inclusive-cache-double-billed.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b2eadbf1c5ee199d169ed6a04cf60ceb7b68cb63e75fd29ac36fc2ad81b3d0c6
---
# estimateCost 对 OpenAI 口径 usage 双重计费 cache read

**现象**（2026-07-24，MemoryBench compare 组，codex/gpt-5.6-luna）：`estimatedCostUSD` 报 $11.14 / $18.17 / $22.43（baseline/mempal/nowledge），按官方价目手算应为 $2.15 / $3.15 / $4.03——虚高 5.2~5.6 倍。用 attempt `result.json` 可精确复现：报告值恒等于 `inputTokens×in + cacheReadTokens×cacheRead + outputTokens×out`，而 codex 的 `cacheReadTokens`（36.8M）是 `inputTokens`（39.9M）的**子集**（92%）。

**根因**：桶语义在 adapter 边界没有归一，计价公式却假设了单一语义。

- `Usage` 契约（`src/o11y/types.ts`）明确「协议报什么记什么，不换算」：Anthropic 系（claude-code）的 `input_tokens` **不含** cache read（桶互斥）；OpenAI 系（codex `cached_input_tokens`、Chat Completions `prompt_tokens_details.cached_tokens`、Responses `input_tokens_details.cached_tokens`、ai-sdk `cachedInputTokens`）的 cached 是 input 的**子集**。四处 adapter（`sdk-streams.ts` 两个 transformer、`openai-compat.ts` 两个 usage 映射、`ai-sdk.ts`）全部原样透传子集语义。
- `estimateCost`（`src/o11y/cost.ts`）把四个桶**直接相加**——只对互斥语义正确。对 OpenAI 系：cache 命中的 token 先按 in 全价计一次（藏在 inputTokens 里）、再按 cacheRead 价加一次。cache 占比 ~92%、cacheRead=in/10 时,总额 ≈ 真实成本的 5.5 倍。
- 隐藏放大器：cache 桶缺专门单价时「退回 in 价」的兜底,在子集语义下等于把 cache 命中按全价计**两次**。

**波及面**：所有走价目表估算的 OpenAI 系 adapter（codex CLI/SDK、openai-compat、ai-sdk 接 OpenAI）。Anthropic 系不受影响（本来就互斥）。claude-code SDK 带回实测 `total_cost_usd`（`usage.costUSD` 优先级更高）也不受影响。**跨家族成本对比（claude vs codex 实验组）在此 bug 下系统性偏向 claude**。token 数本身（input/cacheRead/output 各桶）是如实记录的,不受影响——失真只在换算成钱这一步。

**修法**（2026-07-24 已修）：采用「adapter 边界归一成互斥桶」——`Usage` 契约改为三个输入侧桶恒互斥（`docs/feature/results/architecture.md#usage` 重写,`src/o11y/types.ts` TSDoc 同步）,七个 OpenAI 系生产点落 `inputTokens` 前扣掉缓存明细并夹底 0：`src/agents/sdk-streams.ts`（codex turn.completed）、`src/o11y/parsers/codex.ts`、`src/agents/openai-compat.ts`（Chat Completions + Responses）、`src/agents/ai-sdk.ts`（cacheRead+cacheWrite 都扣）、`src/agents/langgraph.ts`（cache_read+cache_creation 都扣）、`src/o11y/parsers/bub.ts`；Anthropic / pi 系原生互斥不动。`estimateCost` 公式不变（互斥下逐桶相加即正确）。报告层 `uncachedInputTokens` 派生字段整个删除（`inputTokens` 即未缓存输入,"uncached in" 标注由 face 层在 cache 桶在场时给）：`src/report/model/types.ts`、`compute.ts`、`faces.ts`、`UsageTable.tsx`、`src/show/index.ts`。各 adapter 口径逐家声明在 `docs/feature/adapters/sdk/<name>/cost.md`（10 篇新文档）。测试锁定在 `src/agents/{sdk-streams,openai-compat,ai-sdk,langgraph}.test.ts` 与 `src/o11y/parsers/{codex,bub}.test.ts`。**注意断代**：此前所有 OpenAI 系 run 的落盘 `usage.inputTokens` 是含缓存总量、`estimatedCostUSD` 虚高 ~5.5x,与新 run 对比时要按旧口径换算（uncached = input − cacheRead）。

**对已有分析的影响**：MemoryBench 的 nowledge-vs-mempal 成本结论（见该仓库 memory `nowledge-vs-mempal-context-tax`）绝对值全部虚高 ~5.5x；且因 cache read 真实单价是 in 的 1/10,「常驻上下文税」的美元占比被高估 ~10 倍,修正后差额主导项从常驻税移向未缓存增量与 output。
