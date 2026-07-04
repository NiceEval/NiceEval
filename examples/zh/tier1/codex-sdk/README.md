# codex-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/codex-sdk`](../../origin/codex-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

codex-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) 的 `thread.runStreamed()`，
服务端把原生 `ThreadEvent` 流原样透传成 SSE。它是**编码 agent**：有一个固定的 scratch 工作目录
`workspace/`（运行时生成，不清空），eval 测的是真实的"在目录里写文件、跑命令"，不是纯聊天。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。Tier 2（把
`threadOptions`——sandbox mode 等——提升为环境变量，解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/codex-sdk.ts`：adapter 本体,只剩**传输粘合**——应用在哪个 URL(`CODEX_SDK_URL`,
  默认 `http://127.0.0.1:5199`)。事件分工全在官方件里:
  `events: otelEvents({ dialects: [otel.codex] })` 从 codex CLI 原生 OTLP 的 span 派生工具调用
  （`tool_name` + `call_id`,如 `exec_command` / `apply_patch`）和 usage
  （`codex.turn.token_usage.*`）,瀑布图经官方 `mapCodexSpans` 归一;span 上没有的消息文本
  （`agent_message` / `reasoning`）由官方转换器 `fromCodexThreadEvents` 从 `ThreadEvent` 帧
  翻译。codex 的 span 没有工具 I/O,要做 I/O 断言的话按 `call_id` 手写补即可(本示例的断言
  直接读磁盘,不需要)。**没有 HITL**（Codex SDK 不支持），永不返回 `waiting`。
- `evals/`：基础问答、创建文件（用 `node:fs` 直接核实磁盘上的真实内容，不只信模型自述）、跑
  shell 命令、跨轮记忆 + `newSession()` 隔离（用口头偏好而不是文件是否存在做隔离信号，见
  `session-isolation.eval.ts` 注释——`workspace/` 是所有 thread 共享的同一份磁盘状态）。
- `experiments/codex-sdk.ts`：单配置基线。这个应用只有一个可用模型档位，没有
  `experiments/compare-models/`（`docs/origin-integration.md` 的验收清单里多模型对比只点名了
  ai-sdk-v7 / claude-sdk / pi-sdk）。

## 声明的能力位

- `conversation: true`——已验证：`isNew` 时不带 `threadId` 开新会话、`thread.started` 帧回传的
  `thread_id` 写回 `ctx.session.id`、非 `isNew` 时带 id 经 `codex.resumeThread` 续接同一条历史
  （SDK 落盘在 `~/.codex/sessions`）。
- `toolObservability: true`——已验证：每次真实的工具执行都有带 `tool_name` + `call_id` 的
  span（`otel.codex` 方言据此派生配对的 `action.called`/`action.result`,如 run-command eval
  断言的 `exec_command`）,覆盖完整。注意工具名是 span 上的 codex 内部名（`exec_command`）,
  不是 `ThreadEvent` item 的 `command_execution`——两套命名来自 codex 的不同层。
- `tracing: true` + `tracing: { scope: "run", env }`——codex CLI 原生 `otel` 配置段导出 trace
  spans，长驻服务必须 `scope: "run"`（整个 run 共享一个接收器，默认 per-attempt 端口会在第一个
  attempt 结束后失效）；`env` 剥掉 `/v1/traces` 尾巴，codex 自己在配置里拼。
  `spanMapper: mapCodexSpans`（`"niceeval/adapter"` 公开导出）把 codex 自家的 span 命名归一成
  canonical GenAI 语义,瀑布图和内置 `codexAgent` 一致。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。

```sh
cd examples/zh/tier1/codex-sdk
pnpm install
cp .env.example .env   # 填 CODEX_API_KEY / CODEX_BASE_URL

# 终端 1:起应用(要瀑布图/工具事件就把 OTel 指到 niceeval 的固定接收端口,标准 OTLP 4318;
# 本机 4318 被占时,两边一起换:应用改这里的端口,eval 侧用 NICEEVAL_OTLP_PORT 覆盖)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start

# 终端 2:跑 eval(应用部署在别处时设 CODEX_SDK_URL 指过去)
pnpm exec niceeval exp codex-sdk
pnpm exec niceeval view
```

`workspace/` 目录会在磁盘上留下 eval 跑过的文件（比如 `niceeval-create-file.txt`），这是预期
行为，不需要手动清理——`create-file.eval.ts` 每次跑之前会自己删掉它要检查的那个文件,保证断言
看到的是这一轮真实写入的内容。
