# ai-sdk-v7 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/ai-sdk-v7`](../../origin/ai-sdk-v7/) 的**逐字节副本**（除
`package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与
origin 完全一致，见 [`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的
三条铁律）+ 新增的 niceeval 接入代码：`agents/`、`evals/`、`experiments/`、
`niceeval.config.ts`。

本目录做的是**对着 HTTP 接口的无侵入接入**——adapter 只会 `fetch()`
`../src/backend/server.ts` 暴露的 `/api/chat`，不 import 任何应用代码。

ai-sdk-v7 应用本身（`src/backend/`）**一行没改**——服务端零状态，每轮请求体都要带上完整的
`UIMessage[]`（AI SDK v7 的"客户端带全量历史"模式，五个应用里唯一一个）。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。Tier 2
（把 system prompt / 工具集提升为环境变量，解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/ai-sdk-v7.ts`：adapter 本体——就是一个**内置 `uiMessageStreamAgent` 的配置调用**
  （UI Message Stream 协议的官方无侵入 adapter,`"niceeval/adapter"` 导出）。SSE 归约
  （官方 reducer `readUIMessageStream`）、"客户端带全量历史"的会话重放、HITL 审批 part
  改写重发、工具/消息事件从协议帧直构,全部是工厂内置行为;这里只声明端点在哪(按需拉起
  本地服务)、请求体怎么带 `model`、OTel 端点注入方式。
  另声明 `events: otelEvents({ dialects: [otel.genAi] })` 补 usage——协议帧里没有 usage,
  从应用官方 `@ai-sdk/otel` 集成产的 GenAI spans 派生;工具/消息事件按 callId/文本与协议
  直构结果自动去重。（`@ai-sdk/otel` 对 `needsApproval` 工具的审批链路不产 `execute_tool`
  span 的 gap 见 `memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md`——本接法事件不
  依赖 span,该 gap 不影响这里。）
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`：单配置基线。`experiments/compare-models/`：deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比。

## 声明的能力位

- `conversation: true`——已验证：`isNew` 时生成新 `sessionId`、非 `isNew` 时按 `sessionId`
  找回完整历史并原样重发（服务端零状态，续接完全靠客户端重放）。
- `toolObservability: true`——工厂恒开且真做到：`get_weather` / `calculate`（含审批批准/
  拒绝两条分支）每次调用的 `action.called`/`action.result` 都从协议帧直构，无遗漏。
- `tracing: true`——`tracing.env` 给 base（去掉 `/v1/traces` 尾巴，`OTLPTraceExporter()`
  自己拼），`scope: "run"`（长驻共享服务，不像其它四个按 model 分桶）。额外注入
  `OTEL_BSP_SCHEDULE_DELAY`，配合工厂的 `settleMs` 收尾宽限，解决 `BatchSpanProcessor`
  调度延迟和"轮次几时结束"两条时间线对不齐的问题（同
  `memory/langsmith-dialect-langchain-completion-shape-gap.md` 记录的 langgraph 那次）。

## HITL

`calculate` 工具声明了 `needsApproval: true`（AI SDK 自己的 tool loop 停轮机制）。**没有
approve 端点**——批准/拒绝的决定是把上一条（还停在 `approval-requested` 状态的）assistant
消息原地改成 `approval-responded`，原样重发整个 `messages` 数组触发服务端续跑，和真实前端
`addToolApprovalResponse` + 自动重发的效果完全一致——这套握手现在整个是
`uiMessageStreamAgent` 的内置行为（拒绝时默认带"不要重试"的 reason,可用 `denyReason`
覆盖）。`approval.id` **不是** `toolCallId`，是流里单独发的 `approvalId`
（`tool-approval-request` chunk 里的字段，打帧确认过）。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。model 走请求体
(`ai-sdk-runtime.ts` 的 `resolveModel` 每次请求都重新解析),一个实例服务所有 model,
`compare-models` 的多个实验组打同一个服务。

```sh
cd examples/zh/tier1/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY

# 终端 1:起应用(要瀑布图/usage 就把 OTel 指到 niceeval 的固定接收端口,标准 OTLP 4318;
# 本机 4318 被占时,两边一起换:应用改这里的端口,eval 侧用 NICEEVAL_OTLP_PORT 覆盖)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_BSP_SCHEDULE_DELAY=200 pnpm run dev:server

# 终端 2:跑 eval(应用部署在别处时设 AI_SDK_V7_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view
```
