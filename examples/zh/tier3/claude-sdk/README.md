# claude-sdk 示例：niceeval Tier 3 接入（侵入改造 + experiment flags）

这是 [`examples/zh/tier1/claude-sdk`](../../tier1/claude-sdk/) 的**副本 + 一层侵入 delta**
（分档定义见 [docs-site · Tier](../../../../docs-site/zh/explanation/tier.mdx);这个应用没有
Tier 2——Claude Code CLI 的原生遥测只有 metrics+logs,niceeval 只消费 trace spans,所以
tier3 直接叠在 tier1 之上)。Tier 1 应用代码一行不改;这一档**改应用内部代码**,把内部
可变点暴露成 experiment 可选的配置——对照的不再只是模型,而是应用自己的行为变体。

这个应用暴露的可变点:**system prompt**(`docs/origin-integration.md`「Tier 3 备忘」点名
的最小侵入点之一)。相对 tier1 的全部差异:

- `src/backend/agent.ts`:`runTurn` 多一个可选参数 `systemPrompt`;**不传时行为与改造前
  逐字节等价**——侵入改造的铁律是默认行为不变。
- `src/backend/server.ts`:`/api/chat` 请求体多一个可选字段 `systemPrompt`(类型校验)。
- `agents/claude-sdk.ts`:experiment 的 `flags.systemPrompt` 经 `ctx.flags` 随请求体透传。
- `experiments/compare-prompts/`:默认 prompt vs 极简风格两个变体。
- 本 README。

注意侵入的是**应用**(把变体暴露成配置),不是接入面——adapter 依然只对着 HTTP 端点收发,
eval 侧照旧不 spawn 进程、不开新端口。

## flags 怎么流动

```
experiments/compare-prompts/concise.ts  →  flags: { systemPrompt: "…极简…" }
agents/claude-sdk.ts                    →  ctx.flags.systemPrompt 塞进请求体
src/backend/server.ts                   →  校验后交给 runTurn
src/backend/agent.ts                    →  options.systemPrompt ?? SYSTEM_PROMPT
```

evals 一条没改——feature A/B 的判读就是同一批 eval 在不同变体下的对照:极简变体下工具
断言、HITL 批准/拒绝应当照常绿(变体 prompt 原样保留了工具规则),看点在 judge 分与回复
长度的差异。会话续接走 SDK 的 `resume`,每轮 `query()` 都重新给 options,同一实验组内
flags 恒定,变体之间不会串。

## 已验证的行为

`defineAgent` 必须声明真实的 `evidenceCoverage`；这里的官方
`createClaudeSdkEventStream` 完整转换原生 `SDKMessage`，因此使用
`completeEvidenceCoverage`。

- 会话续接:新会话线不带 `sessionId` 开新会话、`system`/`init` 帧回传的 `session_id` 写回
  `ctx.session.id`,同一条会话线带 id 经 SDK 的 `resume` 续接同一条历史(SDK 落盘在
  `~/.claude/projects/`)。这些存取器都在 `ctx.session` 上,adapter 不需要声明任何东西。
- 工具可观测性:`get_weather` / `calculate` 每次调用都有配对的
  `tool_use` → `operation.started`、`tool_result`(或拒绝时的 `system`/`permission_denied`)→
  `operation.finished`,无遗漏。
- **没有 trace 瀑布图**:claude-code CLI 原生遥测(`CLAUDE_CODE_ENABLE_TELEMETRY=1`)只导出
  metrics + logs,没有 trace spans——niceeval 只消费 trace spans,这个应用在形态矩阵里是
  "只有 metrics+logs"档。`niceeval view` 这个应用没有调用瀑布图——这不是接入疏漏,是应用侧现状。

## HITL

`calculate` 工具经 `query()` 的 `canUseTool` 挂了审批(见 `src/backend/agent.ts` 头注释)。这里
**没有显式的"等审批"帧**——`canUseTool` 把 SDK 内部执行卡在一个 Promise 上,SSE 流本身不产出
新消息。adapter 见到 gated 工具(`mcp__demo-tools__calculate`,MCP 命名空间下的真实工具名,不是
裸的 `calculate`)的 `tool_use` 块就直接判定"停在审批上",把"读了一半的流"存进模块级
typed slot，下一次 `t.respond("approve"/"deny")` 从 `ctx.session.take(slot)` 取回，再打 `/api/chat/approve` 端点
(字段名 `toolUseId`)后**继续读同一条流**到结束。拒绝时 SDK 发 `system`/`permission_denied`
帧(带 `tool_use_id`),映射成 `status: "rejected"`。

提示词工程踩坑记录:提示词里明说"这个要经过审批"会让某些模型倾向于用自然语言反问用户
"可以吗?",而不是真的发起工具调用(在 pi-sdk 的接入里复现过同样的行为,已同步改成不提审批
的自然问法);审批门本来就是服务端自动挂的,跟用户怎么问无关。

## 跑起来

```sh
cd examples/zh/tier3/claude-sdk
pnpm install
cp .env.example .env   # 填 ANTHROPIC_* 与 NICEEVAL_JUDGE_*(judge 独立凭证,必需)

# 终端 1:起应用
pnpm start

# 终端 2:跑 A/B(两个变体打同一个应用实例,不用重启)
pnpm exec niceeval exp compare-prompts
pnpm exec niceeval view
```

单配置基线 `pnpm exec niceeval exp assistant` 仍然可用(不带 flags,应用走默认行为)。
其余细节(并发限制)见 [tier1 README](../../tier1/claude-sdk/README.md),
这一层没有改变它们。
