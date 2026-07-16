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

## 这是 Tier 1（只接 send）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。全套断言
都在这一档。往上还有两档，同一个应用各有一个目录，逐层只加一层 delta（分档定义见
[docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx)）：

- **Tier 2（send + OTel）**：[`../../tier2/langgraph/`](../../tier2/langgraph/)——config 加
  `telemetry`、adapter 加一段 span 收尾宽限,应用启动命令加 LangSmith OTel 环境变量,换
  `niceeval view` 的调用瀑布图。
- **Tier 3（侵入改造 + experiment flags）**：[`../../tier3/langgraph/`](../../tier3/langgraph/)
  ——应用侧把 system prompt 暴露成请求可选字段,解锁 feature A/B test。

## 目录

- `agents/langgraph.ts`：adapter 本体,只剩传输粘合——应用在哪个 URL(`LANGGRAPH_URL`,默认
  `http://127.0.0.1:35000`)、自定义帧怎么解析、审批打哪个端点。应用由你自己按它的方式启动
  (`python server.py`),eval 不代管进程。
  **断言依据全部来自应用自己的 SSE 帧**,逐帧映射:`tool-input` → `action.called`、
  `tool-output` → `action.result`(completed)、`tool-output-denied` → `action.result`
  (rejected,called 在上一轮的 `tool-input` 已落,同一个 `toolCallId` 跨轮配对)、
  `text-delta` 累积成完整回复在轮次结束补一条 `message`、`session` → `ctx.session.capture`、
  `tool-approval-request` → `input.requested` + `waiting`(停轮现场用 `ctx.session.hold`
  存住,回答轮 `ctx.session.take` 取回接着读同一条流)、`error` → `failed`、`finish` → 结束。
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
  `action.called`/`action.result`,全部来自协议帧映射(approve 分支 `tool-input`/`tool-output`
  正常配对,deny 分支 rejected 的 result 与上一轮的 called 按 `toolCallId` 跨轮配对),无遗漏。
- `EvalResult.trace`、`niceeval view` 瀑布图——这一档没有,它是 Tier 2 的产物,见
  [`../../tier2/langgraph/`](../../tier2/langgraph/)。断言不受影响,span 本来就不喂断言。

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

# 终端 1:起应用
.venv/bin/python src/backend/server.py

# 终端 2:跑 eval(应用部署在别处时设 LANGGRAPH_URL 指过去)
pnpm exec niceeval exp langgraph
pnpm exec niceeval view
```
