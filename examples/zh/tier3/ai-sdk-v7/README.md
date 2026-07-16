# ai-sdk-v7 示例：niceeval Tier 3 接入（侵入改造 + experiment params）

这是 [`examples/zh/tier2/ai-sdk-v7`](../../tier2/ai-sdk-v7/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。前两档应用代码
一行不改;这一档**改应用内部代码**,把内部可变点暴露成 experiment 可选的配置——对照的不再
只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt 与工具集**(`docs/origin-integration.md`「Tier 3
备忘」点名的最小侵入点)。相对 tier2 的全部差异:

- `src/backend/ai-sdk-runtime.ts`:`streamChat` 多一个可选的 `overrides`
  (`instructions` 覆盖 system prompt、`tools` 按名字挑工具子集);**不传时行为与改造前
  逐字节等价**——侵入改造的铁律是默认行为不变。
- `src/backend/server.ts`:`/api/chat` 请求体多 `instructions` / `tools` 两个可选字段。
- `agents/ai-sdk-v7.ts`:experiment 的 params 经 `ctx.params` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## params 怎么流动

```
experiments/compare-prompts/concise.ts  →  params: { instructions: "…极简…" }
agents/ai-sdk-v7.ts                     →  ctx.params 塞进请求体(instructions / tools)
src/backend/server.ts                   →  透传给 streamChat 的 overrides
src/backend/ai-sdk-runtime.ts           →  instructions ?? SYSTEM_PROMPT、buildTools(tools)
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言应当照常绿(变体 prompt 原样保留了工具规则),看点在 judge 分与回复长度的差异。
`tools` 字段在实验里没用到,但同一条通道已经打通:比如
`params: { tools: ["get_weather", "calculate"] }` 就能对照"禁用 web_search"的变体。

## 跑起来

```sh
cd examples/zh/tier3/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY

# 终端 1:起应用(OTel 部分与 tier2 相同,要瀑布图就带上)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_BSP_SCHEDULE_DELAY=200 pnpm run dev:server

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp assistant`、多模型对比 `compare-models` 仍然可用,
且可以和 params 组合(model 与 params 是 experiment 的两个正交维度)。
