# ai-sdk-v7 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/ai-sdk-v7`](../../tier1/ai-sdk-v7/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter、
同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的调用瀑布
图——应用内部每次模型调用、各自的耗时与 token,按轮铺成时间线。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span,应用启动时用
  标准 OTel 环境变量指过来,跑多少次 eval 都不用改(见 docs-site「通过 OTel 接入 →
  端点怎么交给应用 → 固定端口模式」)。
- `agents/ai-sdk-v7.ts`:加 `settleMs: 600`——应用用 `BatchSpanProcessor`,流结束后留一段
  宽限让最后一批 span 落进本轮收集窗口,只影响瀑布图完整性。
- 本 README。

**应用侧依然零改动**:ai-sdk-v7 本来就带官方 `@ai-sdk/otel` 集成(`src/backend/otel.ts`,
产标准 GenAI 语义的 span),Tier 2 只是让它把 span **也发给 niceeval 一份**——这属于应用
已有的可观测性能力,不是为 eval 定制的改造。

## span 只进瀑布图,不喂断言

事件映射、HITL、会话续接全部还是 `uiMessageStreamAgent` 从协议帧直构(见 tier1 README),
和有没有接 OTel 无关。span 晚到、缺失时也只是瀑布图缺尾巴,断言判决不受影响。一个已知
gap:`@ai-sdk/otel` 对 `needsApproval` 工具的审批链路不产 `execute_tool` span(见
`memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md`)——断言不依赖 span,该 gap 只让
瀑布图少一条 span。

## 目录

- `agents/ai-sdk-v7.ts`：adapter 本体——就是一个**内置 `uiMessageStreamAgent` 的配置调用**
  （UI Message Stream 协议的官方无侵入 adapter,`"niceeval/adapter"` 导出）。SSE 归约
  （官方 reducer `readUIMessageStream`）、"客户端带全量历史"的会话重放、HITL 审批 part
  改写重发、工具/消息事件从协议帧直构,全部是工厂内置行为;这里只声明端点在哪、
  请求体怎么带 `model`。协议帧里没有 usage,所以这个示例没有用量断言。
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`：单配置基线。`experiments/compare-models/`：deepseek-v4-flash /
  deepseek-v4-pro 两个模型对比。

## 能力从哪来

新契约下没有 `capabilities` 标志位；`defineAgent` 只要求如实声明
`evidenceCoverage`。`uiMessageStreamAgent` 已在工厂内声明协议帧完整覆盖的事件、动作、消息和
状态，并把协议不含的 usage 标为 unavailable；`t` 上能判什么仍取决于 adapter 实际接到的证据。
这个示例能验证到：

- 跨轮记忆 + `newSession()` 隔离：已验证——新会话线（首轮）生成新 `sessionId`、之后按
  `sessionId` 找回完整历史并原样重发（服务端零状态，续接完全靠客户端重放）；会话续接的存
  取器是工厂内置行为，agent 配置里不用多写一行。
- 工具事件全量可信（`t.calledTool()` / `t.notCalledTool()` 等负断言可用）：`get_weather` /
  `calculate`（含审批批准/拒绝两条分支）每次调用的 `operation.started`/`operation.finished` 都从协议
  帧直构，无遗漏——这份完整性证明随工厂返回值走，不用声明。
- trace 瀑布图：本档通过 `telemetry` 接收应用已有的 OTel span，`settleMs` 留出末批 span
  的收集宽限，`niceeval view` 据此展示调用时间线；span 只丰富观测，不参与断言判决。

## HITL

`calculate` 工具声明了 `needsApproval: true`（AI SDK 自己的 tool loop 停轮机制）。**没有
approve 端点**——批准/拒绝的决定是把上一条（还停在 `approval-requested` 状态的）assistant
消息原地改成 `approval-responded`，原样重发整个 `messages` 数组触发服务端续跑，和真实前端
`addToolApprovalResponse` + 自动重发的效果完全一致——这套握手现在整个是
`uiMessageStreamAgent` 的内置行为（拒绝时默认带"不要重试"的 reason,可用 `denyReason`
覆盖）。`approval.id` **不是** `toolCallId`，是流里单独发的 `approvalId`
（`tool-approval-request` chunk 里的字段，打帧确认过）。

## 跑起来

和 tier1 的唯一区别:起应用时把 OTel 指到 niceeval 的固定接收端口。

```sh
cd examples/zh/tier2/ai-sdk-v7
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY / DEEPSEEK_API_KEY

# 终端 1:起应用(把 OTel 指到 niceeval 的固定接收端口,标准 OTLP 4318;本机 4318 被占时,
# 两边一起换:应用改这里的端口,eval 侧改 niceeval.config.ts 的 telemetry.port)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_BSP_SCHEDULE_DELAY=200 pnpm run dev:server

# 终端 2:跑 eval(应用部署在别处时设 AI_SDK_V7_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval exp compare-models
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```
