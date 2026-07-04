# pi-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/pi-sdk`](../../origin/pi-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

pi-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 的
`Agent`，走 DeepSeek，服务端把 `agent.subscribe()` 收到的原生 `AgentEvent` 原样透传成 SSE。

## 这是 Tier 1（无侵入）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval，不改被测应用一行代码。Tier 2（把
system prompt / 工具集提升为可配置项,解锁完整 feature A/B test）不在本次范围内。

## 目录

- `agents/pi-sdk.ts`：adapter 本体,只剩**传输粘合**——应用在哪个 URL(`PI_SDK_URL`,默认
  `http://127.0.0.1:5299`)、三种传输层帧(`session` / `approval_request` / `server_error`)
  怎么处理、审批打哪个端点。原生 `AgentEvent` → 标准事件的映射是官方转换器
  `fromPiAgentEvents`(`"niceeval/adapter"` 导出)的事;SSE 读帧用官方 `sseJsonFrames`。
  (pi 无 OTel,官方 OTel 方言帮不上,见形态矩阵 D 档,事件全部来自转换器。)
- `evals/`:基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`:单配置基线。没有 `compare-models`——pi 的模型是应用**启动时**读
  一次的 `AGENT_MODEL`,对外接口不暴露模型选择,Tier 1 拿不到模型对比(要对比就起两个不同
  `AGENT_MODEL` 的实例分别评,或升 Tier 2 把模型提升为请求级配置)。

## 声明的能力位

- `conversation: true`——已验证:`isNew` 时不带 `sessionId` 开新会话、服务端回传的 `sessionId`
  写回 `ctx.session.id`、非 `isNew` 时带 id 续接同一条服务端内存历史(`sessions` Map)。
- `toolObservability: true`——已验证:`get_weather` / `calculate` 每次调用都有配对的
  `tool_execution_start` / `tool_execution_end`,无遗漏。
- **不声明 `tracing`**:pi-agent-core / pi-ai 没有官方 OTel 集成,这是形态矩阵里唯一"完全没有
  OTel"的应用(D 档)。`niceeval view` 这个应用没有调用瀑布图——这不是接入疏漏,是应用侧现状。

## HITL

`calculate` 工具经服务端 `beforeToolCall` 挂了审批(见 `src/backend/server.ts` 头注释)。approval
frame 到达时 SSE 流不关闭——服务端把执行卡在一个 Promise 上,等 `POST /api/chat/approve`。adapter
把"读了一半的流"存进模块级 `Map<sessionId, …>`,下一次 `t.respond("approve"/"deny")` 打 approve
端点后**继续读同一条流**到结束,不重新发 `/api/chat`。批准字段名是 `toolUseId`(不是
`toolCallId`——这是 `/api/chat/approve` 请求体的字段名,和帧里的 `toolCallId` 不是一回事)。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。

```sh
cd examples/zh/tier1/pi-sdk
pnpm install
cp .env.example .env   # 填 DEEPSEEK_API_KEY

# 终端 1:起应用
pnpm start

# 终端 2:跑 eval(应用部署在别处时设 PI_SDK_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval view
```
