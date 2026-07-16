# codex-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/codex-sdk`](../../origin/codex-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

codex-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) 的 `thread.runStreamed()`，
服务端把原生 `ThreadEvent` 流原样透传成 SSE。它是**编码 agent**：有一个固定的 scratch 工作目录
`workspace/`（运行时生成，不清空），eval 测的是真实的"在目录里写文件、跑命令"，不是纯聊天。

## 这是 Tier 1（只接 send）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。全套断言
都在这一档。往上还有两档，同一个应用各有一个目录，逐层只加一层 delta（分档定义见
[docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）：

- **Tier 2（send + OTel）**：[`../../tier2/codex-sdk/`](../../tier2/codex-sdk/)——config 加
  `telemetry`、adapter 加 `spanMapper: mapCodexSpans`，换 `niceeval view` 的调用瀑布图。
- **Tier 3（侵入改造 + experiment flags）**：[`../../tier3/codex-sdk/`](../../tier3/codex-sdk/)
  ——应用侧把 `threadOptions` 的 sandbox mode 暴露成请求体可选字段，解锁 feature A/B test。

## 目录

- `agents/codex-sdk.ts`：adapter 本体,只剩**传输粘合**——应用在哪个 URL(`CODEX_SDK_URL`,
  默认 `http://127.0.0.1:31001`)。断言依据全部来自 `ThreadEvent` 流:官方转换器
  `fromCodexThreadEvents` 映射消息文本(`agent_message` / `reasoning`)、工具项
  (`command_execution` / `mcp_tool_call` / `file_change` → 配对的 `action.called`/`action.result`)
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
  `fromCodexThreadEvents` 据此产配对的 `action.called`/`action.result`(如 run-command eval
  断言的 `command_execution`,按 `exit_code` 判成败),覆盖完整。usage 从 `turn.completed`
  的 `usage`(input/cached/output tokens)聚合进 `Turn.usage`,`t.maxTokens` 可用。
- trace 瀑布图:这一档没有——它是 Tier 2 的产物,见
  [`../../tier2/codex-sdk/`](../../tier2/codex-sdk/)。断言不受影响,span 本来就不喂断言。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。

```sh
cd examples/zh/tier1/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL

# 终端 1:起应用
pnpm start

# 终端 2:跑 eval(应用部署在别处时设 CODEX_SDK_URL 指过去)
pnpm exec niceeval exp codex-sdk
pnpm exec niceeval view
```

`workspace/` 目录会在磁盘上留下 eval 跑过的文件（比如 `niceeval-create-file.txt`），这是预期
行为，不需要手动清理——`create-file.eval.ts` 每次跑之前会自己删掉它要检查的那个文件,保证断言
看到的是这一轮真实写入的内容。
