# codex-sdk 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/codex-sdk`](../../tier1/codex-sdk/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter
骨架、同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的
调用瀑布图。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span,长驻服务必须走
  run 级共享接收器(固定端口模式)。
- `agents/codex-sdk.ts`:加 `spanMapper: mapCodexSpans`(`"niceeval/adapter"` 公开导出)——
  codex 的 span 是自家命名,归一成 canonical GenAI 语义后瀑布图才能正确着色分组,和内置
  `codexAgent` 的瀑布图一致。
- 本 README。

**应用侧依然零改动**:origin 的 `src/backend/agent.ts` 本来就给 Codex CLI 配了原生 `otel`
配置段(trace 导出发生在 codex 子进程内部,默认开启),Tier 2 只是让这些 span **也发给
niceeval 一份**。

## span 只进瀑布图,不喂断言

事件断言的数据来源始终是 `ThreadEvent` 流(官方转换器 `createCodexThreadEventStream`,见 tier1
README),和 span 无关。span 晚到、缺失时也只是瀑布图缺一块,断言判决不受影响。

## 目录

- `agents/codex-sdk.ts`：adapter 本体,只剩**传输粘合**——应用在哪个 URL(`CODEX_SDK_URL`,
  默认 `http://127.0.0.1:31001`)。断言依据全部来自 `ThreadEvent` 流:官方转换器
  `createCodexThreadEventStream` 映射消息文本(`agent_message` / `reasoning`)、工具项
  (`command_execution` / `mcp_tool_call` / `file_change` → 配对的 `operation.started`/`operation.finished`)
  和 `turn.completed` 的 usage。**没有 HITL**（Codex SDK 不支持），永不返回 `waiting`。
- `evals/`：基础问答、创建文件（用 `node:fs` 直接核实磁盘上的真实内容，不只信模型自述）、跑
  shell 命令、跨轮记忆 + `newSession()` 隔离（用口头偏好而不是文件是否存在做隔离信号，见
  `session-isolation.eval.ts` 注释——`workspace/` 是所有 thread 共享的同一份磁盘状态）。
- `experiments/codex-sdk.ts`：单配置基线。这个应用只有一个可用模型档位，没有
  `experiments/compare-models/`（`docs/origin-integration.md` 的验收清单里多模型对比只点名了
  ai-sdk-v7 / claude-sdk / pi-sdk）。

## 接入验证过什么

不需要在 `defineAgent` 上声明任何东西,能力从 `send` 实际做到的事、`events` 里出的证据自然成立:

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

和 tier1 的唯一区别:起应用时把 OTel 指到 niceeval 的固定接收端口(codex 配置里自己拼
`/v1/traces`,这里给 base URL)。

```sh
cd examples/zh/tier2/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL

# 终端 1:起应用(本机 4318 被占时,两边一起换:应用改这里的端口,
# eval 侧改 niceeval.config.ts 的 telemetry.port)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start

# 终端 2:跑 eval(应用部署在别处时设 CODEX_SDK_URL 指过去)
pnpm exec niceeval exp codex-sdk
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```

`workspace/` 目录会在磁盘上留下 eval 跑过的文件,这是预期行为,同 tier1。
