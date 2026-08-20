# codex-sdk 示例：niceeval Tier 3 接入（侵入改造 + experiment flags）

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
- `agents/codex-sdk.ts`:experiment 的 `flags.sandboxMode` 经 `ctx.flags` 随请求体透传。
- `experiments/compare-sandbox/`:workspace-write vs read-only 两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## flags 怎么流动

```
experiments/compare-sandbox/read-only.ts   →  flags: { sandboxMode: "read-only" }
agents/codex-sdk.ts                        →  ctx.flags.sandboxMode 塞进请求体
src/backend/server.ts                      →  校验后交给 runTurnStreamed
src/backend/agent.ts                       →  threadOptions.sandboxMode
```

evals 一条没改——feature A/B 的判读就是**同一批 eval 在不同变体下的红绿对照**:
read-only 变体下 `create-file`(要写盘)预期变红,沙箱拦下写操作正是这个 flag 的行为差异;
基础问答、会话隔离不受影响。

## 目录

- `agents/codex-sdk.ts`：adapter 本体,只剩**传输粘合**——应用在哪个 URL(`CODEX_SDK_URL`,
  默认 `http://127.0.0.1:31001`)。断言依据全部来自 `ThreadEvent` 流:官方转换器
  `createCodexThreadEventStream` 映射消息文本(`agent_message` / `reasoning`)、工具项
  (`command_execution` / `mcp_tool_call` / `file_change` → 配对的 `operation.started`/`operation.finished`)
  和 `turn.completed` 的 usage。**没有 HITL**（Codex SDK 不支持），永不返回 `waiting`。
- `evals/`：基础问答、创建文件（用 `node:fs` 直接核实磁盘上的真实内容，不只信模型自述）、跑
  shell 命令、跨轮记忆 + `newSession()` 隔离（用口头偏好而不是文件是否存在做隔离信号，见
  `session-isolation.eval.ts` 注释——`workspace/` 是所有 thread 共享的同一份磁盘状态）。
- `experiments/codex-sdk.ts`：不带 flags 的单配置基线。`experiments/compare-sandbox/`：
  workspace-write / read-only 两个 sandbox mode 变体；这个应用只有一个可用模型档位，因此仍没有
  `experiments/compare-models/`（`docs/origin-integration.md` 的验收清单里多模型对比只点名了
  ai-sdk-v7 / claude-sdk / pi-sdk）。

## 接入验证过什么

`defineAgent` 必须声明真实的 `evidenceCoverage`；这里的官方
`createCodexThreadEventStream` 完整转换 `ThreadEvent`，因此使用
`completeEvidenceCoverage`。能力仍从 `send` 实际做到的事、`events` 里的证据自然成立：

- 会话续接:新会话线不带 `threadId` 开新会话、`thread.started` 帧回传的 `thread_id` 经
  `ctx.session.capture()` 写回,之后带 `ctx.session.id` 经 `codex.resumeThread` 续接同一条
  历史(SDK 落盘在 `~/.codex/sessions`)。
- 工具可观测:每个工具项在 `ThreadEvent` 流里都有 `item.started`/`item.completed`,
  `createCodexThreadEventStream` 据此产配对的 `operation.started`/`operation.finished`(如 run-command eval
  断言的 `command_execution`,按 `exit_code` 判成败),覆盖完整。usage 从 `turn.completed`
  的 `usage`(input/cached/output tokens)聚合进 `Turn.usage`,`t.maxTokens` 可用。
- trace 瀑布图:本档通过 `telemetry` 接收 Codex CLI 已有的 span，并由 `mapCodexSpans` 归一成
  canonical GenAI 语义，`niceeval view` 因而能正确着色、分组调用时间线；span 只丰富观测，
  不参与断言判决。
## 跑起来

```sh
cd examples/zh/tier3/codex-sdk
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / OPENAI_BASE_URL

# 终端 1:起应用(OTel 部分与 tier2 相同,要瀑布图就带上)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-sandbox
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp codex-sdk` 仍然可用(不带 flags,应用走默认行为)。
