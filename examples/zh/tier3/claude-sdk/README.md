# claude-sdk 示例：niceeval Tier 3 接入（侵入改造 + experiment params）

这是 [`examples/zh/tier1/claude-sdk`](../../tier1/claude-sdk/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx);这个应用没有
Tier 2——Claude Code CLI 的原生遥测只有 metrics+logs,niceeval 只消费 trace spans,所以
tier3 直接叠在 tier1 之上)。Tier 1 应用代码一行不改;这一档**改应用内部代码**,把内部
可变点暴露成 experiment 可选的配置——对照的不再只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt**(`docs/origin-integration.md`「Tier 3 备忘」点名
的最小侵入点之一)。相对 tier1 的全部差异:

- `src/backend/agent.ts`:`runTurn` 多一个可选参数 `systemPrompt`;**不传时行为与改造前
  逐字节等价**——侵入改造的铁律是默认行为不变。
- `src/backend/server.ts`:`/api/chat` 请求体多一个可选字段 `systemPrompt`(类型校验)。
- `agents/claude-sdk.ts`:experiment 的 `params.systemPrompt` 经 `ctx.params` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## params 怎么流动

```
experiments/compare-prompts/concise.ts  →  params: { systemPrompt: "…极简…" }
agents/claude-sdk.ts                    →  ctx.params.systemPrompt 塞进请求体
src/backend/server.ts                   →  校验后交给 runTurn
src/backend/agent.ts                    →  options.systemPrompt ?? SYSTEM_PROMPT
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言、HITL 批准/拒绝应当照常绿(变体 prompt 原样保留了工具规则),看点在 judge 分与回复
长度的差异。会话续接走 SDK 的 `resume`,每轮 `query()` 都重新给 options,同一实验组内
params 恒定,变体之间不会串。

## 跑起来

```sh
cd examples/zh/tier3/claude-sdk
pnpm install
cp .env.example .env   # 填 ANTHROPIC_* 与 NICEEVAL_JUDGE_*(judge 独立凭证,必需)

# 终端 1:起应用
pnpm start

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp assistant` 仍然可用(不带 params,应用走默认行为)。
其余细节(HITL 机制、能力验证、并发限制)见 [tier1 README](../../tier1/claude-sdk/README.md),
这一层没有改变它们。
