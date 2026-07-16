# pi-sdk 示例：niceeval Tier 3 接入（侵入改造 + experiment params）

这是 [`examples/zh/tier1/pi-sdk`](../../tier1/pi-sdk/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx);这个应用没有
Tier 2——pi-agent-core 没有官方 OTel 集成,所以 tier3 直接叠在 tier1 之上)。Tier 1 应用
代码一行不改;这一档**改应用内部代码**,把内部可变点暴露成 experiment 可选的配置——对照
的不再只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt**(`docs/origin-integration.md`「Tier 3 备忘」点名
的最小侵入点之一)。相对 tier1 的全部差异:

- `src/backend/agent.ts`:`CreateAgentOptions` 多一个可选的 `systemPrompt`;**不传时行为
  与改造前逐字节等价**——侵入改造的铁律是默认行为不变。
- `src/backend/server.ts`:`/api/chat` 请求体多一个可选字段 `systemPrompt`(类型校验),
  透传给 `createAgent`。
- `agents/pi-sdk.ts`:experiment 的 `params.systemPrompt` 经 `ctx.params` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## params 怎么流动

```
experiments/compare-prompts/concise.ts  →  params: { systemPrompt: "…极简…" }
agents/pi-sdk.ts                        →  ctx.params.systemPrompt 塞进请求体
src/backend/server.ts                   →  校验后交给 streamChat → createAgent
src/backend/agent.ts                    →  initialState.systemPrompt ?? SYSTEM_PROMPT
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言、HITL 批准/拒绝应当照常绿(变体 prompt 保留了"需要时调用工具"的规则),看点在
judge 分与回复长度的差异。pi 每轮请求都重建 Agent(历史经 `options.messages` 续接),
所以 prompt 覆盖天然是请求级的;同一实验组内 params 恒定,变体之间不会串。

## 跑起来

```sh
cd examples/zh/tier3/pi-sdk
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY 与 NICEEVAL_JUDGE_*(judge 独立凭证,必需)

# 终端 1:起应用(会话在服务端内存里,跑多轮 eval 时不要中途重启)
pnpm start

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp assistant` 仍然可用(不带 params,应用走默认行为)。
其余细节(帧协议、HITL 机制、能力验证)见 [tier1 README](../../tier1/pi-sdk/README.md),
这一层没有改变它们。
