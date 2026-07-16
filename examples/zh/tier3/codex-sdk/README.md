# codex-sdk 示例：niceeval Tier 3 接入（侵入改造 + experiment params）

这是 [`examples/zh/tier2/codex-sdk`](../../tier2/codex-sdk/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。前两档应用代码
一行不改;这一档**改应用内部代码**,把内部可变点暴露成 experiment 可选的配置——对照的不再
只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**`threadOptions` 的 sandbox mode**(`docs/origin-integration.md`
「Tier 3 备忘」点名的最小侵入点)。相对 tier2 的全部差异:

- `src/backend/agent.ts`:`runTurnStreamed` 多一个可选参数 `sandboxMode`,进
  `threadOptions`;**不传时行为与改造前逐字节等价**——侵入改造的铁律是默认行为不变。
- `src/backend/server.ts`:`/api/chat` 请求体多一个可选字段 `sandboxMode`(取值校验,
  非法值 400)。
- `agents/codex-sdk.ts`:experiment 的 `params.sandboxMode` 经 `ctx.params` 随请求体透传。
- `experiments/compare-sandbox/`:workspace-write vs read-only 两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## params 怎么流动

```
experiments/compare-sandbox/read-only.ts   →  params: { sandboxMode: "read-only" }
agents/codex-sdk.ts                        →  ctx.params.sandboxMode 塞进请求体
src/backend/server.ts                      →  校验后交给 runTurnStreamed
src/backend/agent.ts                       →  threadOptions.sandboxMode
```

evals 一条没改——feature A/B 的判读就是**同一批 eval 在不同变体下的红绿对照**:
read-only 变体下 `create-file`(要写盘)预期变红,沙箱拦下写操作正是这个 flag 的行为差异;
基础问答、会话隔离不受影响。

## 跑起来

```sh
cd examples/zh/tier3/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL

# 终端 1:起应用(OTel 部分与 tier2 相同,要瀑布图就带上)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-sandbox
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp codex-sdk` 仍然可用(不带 params,应用走默认行为)。
