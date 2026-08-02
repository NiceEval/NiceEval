# langgraph 示例：niceeval Tier 2 接入（send + OTel）

这是 [`examples/zh/tier1/langgraph`](../../tier1/langgraph/) 的**副本 + 一层 OTel delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。同一个 adapter
骨架、同一批 evals/experiments,断言一条不变;这一档买到的是**观测**:`niceeval view` 的
调用瀑布图。

相对 tier1 的全部差异只有三处(`examples/zh/diffs/` 里有自动导出的 patch 可读):

- `niceeval.config.ts`:加 `telemetry: { port: 4318 }`——固定端口接收 span。
- `agents/langgraph.ts`:加一段 span 收尾宽限(`OTEL_FLUSH_GRACE_MS`,LangSmith 的
  `BatchSpanProcessor` 调度和 SSE 流关闭是两条独立时间线,轮次结束后主动等一小段把最后
  一批 span 收进瀑布图),以及随请求带 `ctx.telemetry.headers` 的 traceparent(server.py
  没接 OTel 服务端埋点,现在读不到这个头,span 走时间窗口归属、该 agent 的轮次自动串行
  ——传了是面向未来:应用哪天接了 W3C trace context 传播就免费解锁精确归属和并发)。
- 本 README。

**应用侧依然零改动**:Python 版 `langsmith` SDK 是真·零代码——`LANGSMITH_TRACING` 等四个
环境变量(见「跑起来」)设好,`langchain_core` 默认的 tracing callback 第一次调模型时就会
自动接好 OTel exporter。Tier 2 只是让这些 span **也发给 niceeval 一份**。

## span 只进瀑布图,不喂断言

事件断言的数据来源始终是应用自己的 SSE 协议帧(见 tier1 README),零 OTel 依赖。span 晚到、
缺失时也只是瀑布图缺一块,断言判决不受影响。一个易踩的坑:Python `langsmith` SDK 把
`OTEL_EXPORTER_OTLP_ENDPOINT` 当**完整 endpoint** 用,要带 `/v1/traces` 尾巴——**和
codex-sdk/ai-sdk-v7 相反**,那两个应用自己拼尾巴。

## 目录

- `agents/langgraph.ts`：adapter 本体,只剩传输粘合——应用在哪个 URL(`LANGGRAPH_URL`,默认
  `http://127.0.0.1:35000`)、自定义帧怎么解析、审批打哪个端点。应用由你自己按它的方式启动
  (`python server.py`),eval 不代管进程。
  **断言依据全部来自应用自己的 SSE 帧**,逐帧映射:`tool-input` → `operation.started`、
  `tool-output` → `operation.finished`(completed)、`tool-output-denied` → `operation.finished`
  (rejected,called 在上一轮的 `tool-input` 已落,同一个 `toolCallId` 跨轮配对)、
  `text-delta` 累积成完整回复在轮次结束补一条 `message`、`session` → `ctx.session.capture`、
  `tool-approval-request` → `input.requested` + `waiting`(停轮现场用 Adapter 私有的 typed slot
  存住,回答轮 `ctx.session.take(slot)` 取回接着读同一条流)、`error` → `failed`、`finish` → 结束。
  协议帧里没有 usage,所以这个示例没有用量断言。
- `evals/`：基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/langgraph.ts`：单配置基线。没有 `compare-models/`——
  `docs/origin-integration.md` 的验收清单里多模型对比只点名了 ai-sdk-v7 / claude-sdk / pi-sdk。

## 能力从哪来

能力不是声明出来的，是构造证明——做到了就是有，不需要在 `defineAgent` 上额外填字段：

- 多轮续接、`t.newSession()` 隔离——已验证：新会话线（`ctx.session.id` 是 `undefined`）不带
  `sessionId` 开新会话、`session` 帧回传的 `sessionId` 经 `ctx.session.capture` 写回
  `ctx.session.id`、已有 id 的会话线带 id 续接同一条历史（LangGraph `InMemorySaver`，进程
  存活期间有效）。
- `t.calledTool()` 等工具断言——已验证：`get_weather` / `calculate` 每次调用都有配对的
  `operation.started`/`operation.finished`,全部来自协议帧映射(approve 分支 `tool-input`/`tool-output`
  正常配对,deny 分支 rejected 的 result 与上一轮的 called 按 `toolCallId` 跨轮配对),无遗漏。
- `EvalResult.trace`、`niceeval view` 瀑布图——本档通过 `telemetry` 接收 LangSmith 已有的
  OTel span；span 只丰富调用时间线，晚到或缺失不改变事件断言的判决。

## HITL

`calculate` 工具经 LangChain 官方的 `HumanInTheLoopMiddleware`（`interrupt_on={"calculate": ...}`）
挂了审批——这是四个手写映射示例里"停轮-恢复"最原生的一种，`agent.py` 不需要自己维护一个
进程内 resolver Map，图本身的暂停/恢复完全由 checkpointer 管；`server.py` 只维护"暂停期间还开着
的 SSE 连接怎么等审批结果"这一件事（`queue.Queue`）。approve 端点字段是 **`toolCallId`**
（不是 pi-sdk/claude-sdk 那个 `toolUseId`）。

## 跑起来

和 tier1 的唯一区别:起应用时给 LangSmith OTel 导出的环境变量。

```sh
cd examples/zh/tier2/langgraph
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 只需要建一次
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY(这里挪用给 DeepSeek,见 niceeval.config.ts 注释)

# 终端 1:起应用(注意 langsmith SDK 要完整路径,端点带 /v1/traces 尾巴;
# niceeval 的接收端口钉在 4318,被占时改 niceeval.config.ts 的 telemetry.port 并同步这里)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces OTEL_BSP_SCHEDULE_DELAY=200 \
.venv/bin/python src/backend/server.py

# 终端 2:跑 eval(应用部署在别处时设 LANGGRAPH_URL 指过去)
pnpm exec niceeval exp langgraph
pnpm exec niceeval view   # 这一档开始,view 里有调用瀑布图
```
