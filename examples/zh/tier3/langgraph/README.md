# langgraph 示例：niceeval Tier 3 接入（侵入改造 + experiment flags）

这是 [`examples/zh/tier2/langgraph`](../../tier2/langgraph/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）。前两档应用代码
一行不改;这一档**改应用内部代码**(Python 侧),把内部可变点暴露成 experiment 可选的配置
——对照的不再只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt**(`docs/origin-integration.md`「Tier 3 备忘」点名
的最小侵入点之一)。相对 tier2 的全部差异:

- `src/backend/agent.py`:`build_agent(system_prompt=None)` 接受 prompt 覆盖;
  `InMemorySaver` 提到模块级共享(`_SAVER`)——`create_agent` 的 system prompt 是图的
  编译期参数,每个变体要各自编译一张图,但共用同一个 checkpointer,同一个 `thread_id`
  的会话记忆与 interrupt/resume 检查点跨变体延续。**不传时行为与改造前完全一致**。
- `src/backend/server.py`:`/api/chat` 请求体多一个可选字段 `systemPrompt`(类型校验),
  同一个变体的图编译一次后缓存复用;`_run_turn`/`_drive_graph` 改为显式接收 agent,
  不再读模块全局。
- `agents/langgraph.ts`:experiment 的 `flags.systemPrompt` 经 `ctx.flags` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## flags 怎么流动

```
experiments/compare-prompts/concise.ts  →  flags: { systemPrompt: "…极简…" }
agents/langgraph.ts                     →  ctx.flags.systemPrompt 塞进请求体
src/backend/server.py                   →  校验后 _agent_for(systemPrompt) 选图
src/backend/agent.py                    →  build_agent(system_prompt or SYSTEM_PROMPT)
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言、HITL 批准/拒绝应当照常绿(变体 prompt 原样保留了工具规则),看点在 judge 分与回复
长度的差异。HITL 的 interrupt 在哪个变体的图上停,resume 就在哪个变体的图上续——同一
实验组内 flags 恒定,不会串。

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

能力不是用 `capabilities` 标志位声明出来的，而是由构造和证据证明；不过
`defineDirectAgent` 必须如实填写 `evidenceCoverage`。这个手写协议映射明确声明 events、actions、
messages 与 status 完整，协议未提供的 usage 和 adapter 未产生的 `Turn.data` 标为 unavailable：

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

```sh
cd examples/zh/tier3/langgraph
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 只需要建一次
pnpm install
cp .env.example .env   # 填 OPENAI_API_KEY(这里挪用给 DeepSeek,见 niceeval.config.ts 注释)

# 终端 1:起应用(OTel 部分与 tier2 相同,要瀑布图就带上这些环境变量)
LANGSMITH_TRACING=true LANGSMITH_OTEL_ENABLED=true LANGSMITH_OTEL_ONLY=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces OTEL_BSP_SCHEDULE_DELAY=200 \
.venv/bin/python src/backend/server.py

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp langgraph` 仍然可用(不带 flags,应用走默认行为)。
其余细节(帧协议、HITL 机制、能力验证)见 [tier1 README](../../tier1/langgraph/README.md)
与 [tier2 README](../../tier2/langgraph/README.md),这一层没有改变它们。
