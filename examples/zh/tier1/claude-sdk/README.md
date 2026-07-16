# claude-sdk 示例：niceeval Tier 1 接入

这是 [`examples/zh/origin/claude-sdk`](../../origin/claude-sdk/) 的**逐字节副本**（除 `package.json` /
`pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件，其余复制文件与 origin 完全一致，见
[`docs/origin-integration.md`](../../../../docs/origin-integration.md) 的三条铁律）+ 新增的 niceeval
接入代码：`agents/`、`evals/`、`experiments/`、`niceeval.config.ts`。

claude-sdk 应用本身（`src/backend/`）**一行没改**——真实 agent 是
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 的
`query()`,服务端把原生 `SDKMessage` 流原样透传成 SSE。

## 这是 Tier 1（只接 send）

adapter 只是把这个已有的 HTTP + SSE 服务无侵入接进 niceeval,不改被测应用一行代码(分档定义见
[docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx))。这个应用没有 Tier 2——
Claude Code CLI 的原生遥测只有 metrics+logs,niceeval 只消费 trace spans,没有 span 可接。
**Tier 3(侵入改造 + experiment flags)**在 [`../../tier3/claude-sdk/`](../../tier3/claude-sdk/):
应用侧把 system prompt 暴露成请求体可选字段,解锁 feature A/B test。

## 目录

- `agents/claude-sdk.ts`:adapter 本体,只剩**传输粘合**——应用在哪个 URL(`CLAUDE_SDK_URL`,
  默认 `http://127.0.0.1:32001`)、HITL 停轮怎么判、审批打哪个端点。原生 `SDKMessage`
  (`system`/`assistant`/`user`/`result`)→ 标准事件的映射是官方转换器
  `fromClaudeSdkMessages`(`"niceeval/adapter"` 导出)的事;SSE 读帧用官方 `sseJsonFrames`。
  `stream_event`(逐 token 渲染用)转换器整个忽略。
- `evals/`:基础问答、天气工具调用、跨轮记忆 + `newSession()` 隔离、HITL 批准/拒绝。
- `experiments/assistant.ts`:单配置基线。没有 `compare-models`——模型是应用**启动时**读一次的
  `AGENT_MODEL`,对外接口不暴露模型选择,Tier 1 拿不到模型对比(要对比就起两个不同
  `AGENT_MODEL` 的实例分别评,或走 Tier 3 的路子把模型提升为请求级配置)。

## 已验证的行为

- 会话续接:新会话线不带 `sessionId` 开新会话、`system`/`init` 帧回传的 `session_id` 写回
  `ctx.session.id`,同一条会话线带 id 经 SDK 的 `resume` 续接同一条历史(SDK 落盘在
  `~/.claude/projects/`)。这些存取器都在 `ctx.session` 上,adapter 不需要声明任何东西。
- 工具可观测性:`get_weather` / `calculate` 每次调用都有配对的
  `tool_use` → `action.called`、`tool_result`(或拒绝时的 `system`/`permission_denied`)→
  `action.result`,无遗漏。
- **没有 trace 瀑布图**:claude-code CLI 原生遥测(`CLAUDE_CODE_ENABLE_TELEMETRY=1`)只导出
  metrics + logs,没有 trace spans——niceeval 只消费 trace spans,这个应用在形态矩阵里是
  "只有 metrics+logs"档。`niceeval view` 这个应用没有调用瀑布图——这不是接入疏漏,是应用侧现状。

## HITL

`calculate` 工具经 `query()` 的 `canUseTool` 挂了审批(见 `src/backend/agent.ts` 头注释)。这里
**没有显式的"等审批"帧**——`canUseTool` 把 SDK 内部执行卡在一个 Promise 上,SSE 流本身不产出
新消息。adapter 见到 gated 工具(`mcp__demo-tools__calculate`,MCP 命名空间下的真实工具名,不是
裸的 `calculate`)的 `tool_use` 块就直接判定"停在审批上",把"读了一半的流"存进模块级
`Map<sessionId, …>`,下一次 `t.respond("approve"/"deny")` 打 `/api/chat/approve` 端点
(字段名 `toolUseId`)后**继续读同一条流**到结束。拒绝时 SDK 发 `system`/`permission_denied`
帧(带 `tool_use_id`),映射成 `status: "rejected"`。

提示词工程踩坑记录:提示词里明说"这个要经过审批"会让某些模型倾向于用自然语言反问用户
"可以吗?",而不是真的发起工具调用(在 pi-sdk 的接入里复现过同样的行为,已同步改成不提审批
的自然问法);审批门本来就是服务端自动挂的,跟用户怎么问无关。

## 跑起来

被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。

```sh
cd examples/zh/tier1/claude-sdk
pnpm install
cp .env.example .env   # 填 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL

# 终端 1:起应用
pnpm start

# 终端 2:跑 eval(应用部署在别处时设 CLAUDE_SDK_URL 指过去)
pnpm exec niceeval exp assistant
pnpm exec niceeval view
```
