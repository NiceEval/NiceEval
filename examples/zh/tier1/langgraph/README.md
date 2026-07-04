# langgraph 示例：niceeval Tier 1 接入

`src/`、`requirements.txt`、`docker-compose.yml`、`.env(.example)`、`.gitignore` 是
[`examples/zh/origin/langgraph`](../../origin/langgraph/) 的**逐字节副本**（见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）。
`package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 是**全新文件**——origin 是纯 Python
项目，没有这三个：niceeval 的 adapter/eval/experiment 代码要跑起来需要一个独立的 TS 侧项目，
和 Python 应用本身完全分开、互不干扰。

langgraph 应用本身（`src/backend/`）**一行没改**——真实 agent 是 LangChain 1.x 的
`create_agent`（内部是编译好的 LangGraph 图），服务端把 LangGraph 的 stream 事件翻译成一套
自定义 JSON 帧（`text-delta` / `tool-input` / `tool-output` / `tool-approval-request` /
`tool-output-denied`）透传成 SSE。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。Tier 2（把
`HumanInTheLoopMiddleware` 开关、system prompt 提升为环境变量，解锁完整 feature A/B test）不在
本次范围内。

## 目录

- `agents/langgraph.ts`：adapter 本体,只剩传输粘合——应用在哪个 URL(`LANGGRAPH_URL`,默认
  `http://127.0.0.1:5488`)、自定义帧怎么解析、审批打哪个端点。应用由你自己按它的方式启动
  (`python server.py`,LangSmith OTel 环境变量启动时给,见「跑起来」),eval 不代管进程。
  事件来源是
  `events: otelEvents({ dialects: [otel.langsmith] })`——LangSmith OTel 导出的 span 派生
  `action.called` / `action.result` / usage，SSE 帧只解析协议语义点：`session` → 写回
  `ctx.session.id`；`tool-approval-request` → `input.requested` + `waiting`；
  `tool-output-denied` → `action.result`（`status:"rejected"`，span 里没有"人拒绝"这个语义，
  这条是 adapter 手动补的）；`error` → `failed`；`finish` → 结束哨兵。`tool-output` 不用翻译。

  两处**没有**照抄"span 全包"的理想状态，是实测出来的真实限制，都记进了 `memory/`：
  - **消息文本**：`langsmith` 方言解析不了 LangChain `ChatOpenAI` 实际吐的
    `gen_ai.completion` 形状（`{generations:[[{text,...}]]}`），`message` 事件永远派生成空。
    adapter 自己累积协议原生的 `text-delta` 帧拼成完整回复，在轮次结束时补一条 `message`
    事件——和 span 派生的工具/usage 事件按文档"两边按时间戳合并"的设计共存，不是 hack。见
    `memory/langsmith-dialect-langchain-completion-shape-gap.md`。
  - **gated 工具（`calculate`）的 `action.called`**：同一份 gap 还导致 `langsmith` 方言给
    "tool" 类型 span 派生 `callId` 时读不到 `gen_ai.tool.call.id`，退化用 `span.spanId`——和
    协议帧里的真实 `toolCallId` 对不上。`get_weather` 这类正常执行的工具不受影响（span 派生
    自洽的一对，断言不关心 callId 具体值）；但被拒绝的 `calculate` 调用**从来不会真的执行，
    根本没有 span**，只能靠 adapter 缓存 `tool-input` 帧的信息，在 `tool-output-denied` 到达
    时手动补一对用真实 `toolCallId` 配对的 `action.called`/`action.result`——approve 分支不需要
    这个补丁（留给 span 派生），避免产生一条永远等不到配对结果的幽灵记录。
  - 另外一个独立的时序问题：LangSmith 的 `BatchSpanProcessor` 默认调度延迟和"这一轮 HTTP
    请求几时返回"对不齐，最后一次模型调用的 span 经常在轮次已经结束后才导出。`tracing.env`
    额外注入了 `OTEL_BSP_SCHEDULE_DELAY=200`（标准 OTel 环境变量），adapter 在轮次结束后也
    主动等一小段宽限时间（`OTEL_FLUSH_GRACE_MS`）再返回，把 niceeval 的收集窗口拉宽。
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/langgraph.ts`：单配置基线。没有 `compare-models/`——
  `docs/origin-integration.md` 的验收清单里多模型对比只点名了 ai-sdk-v7 / claude-sdk / pi-sdk。

## 声明的能力位

- `conversation: true`——已验证：`isNew` 时不带 `sessionId` 开新会话、`session` 帧回传的
  `sessionId` 写回 `ctx.session.id`、非 `isNew` 时带 id 续接同一条历史（LangGraph
  `InMemorySaver`，进程存活期间有效）。
- `toolObservability: true`——已验证：`get_weather` / `calculate` 每次调用都有配对的
  `action.called`/`action.result`（前者纯 span 派生，后者 approve 分支走 span、deny 分支走
  adapter 手动补，见上面「目录」的说明），无遗漏。
- `tracing`（proven by 声明了 `tracing` 块 + `events: otelEvents()`，不用重复写
  `capabilities.tracing`）——`tracing.env` 给完整路径（**和 codex-sdk/ai-sdk-v7 相反**，那两个
  应用自己拼 `/v1/traces` 尾巴，这里 Python `langsmith` SDK 直接把这个值当完整 endpoint 用），
  同时注入三个 `LANGSMITH_*` 开关 + `OTEL_BSP_SCHEDULE_DELAY`。

## HITL

`calculate` 工具经 LangChain 官方的 `HumanInTheLoopMiddleware`（`interrupt_on={"calculate": ...}`）
挂了审批——这是四个手写映射示例里"停轮-恢复"最原生的一种，`agent.py` 不需要自己维护一个
进程内 resolver Map，图本身的暂停/恢复完全由 checkpointer 管；`server.py` 只维护"暂停期间还开着
的 SSE 连接怎么等审批结果"这一件事（`queue.Queue`）。approve 端点字段是 **`toolCallId`**
（不是 pi-sdk/claude-sdk 那个 `toolUseId`）。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。

```sh
cd examples/zh/tier1/langgraph
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 只需要建一次
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY(这里挪用给 DeepSeek,见 niceeval.config.ts 注释)

# 终端 1:起应用(LangSmith OTel 导出的环境变量在这里给——注意 langsmith SDK 要完整路径,
# 端点带 /v1/traces 尾巴;niceeval 的接收端口钉在 4318,被占时两边一起换 + NICEEVAL_OTLP_PORT)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces OTEL_BSP_SCHEDULE_DELAY=200 \
.venv/bin/python src/backend/server.py

# 终端 2:跑 eval(应用部署在别处时设 LANGGRAPH_URL 指过去)
pnpm exec niceeval exp langgraph
pnpm exec niceeval view
```
