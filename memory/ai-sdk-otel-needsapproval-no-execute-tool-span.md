---
format: concord.document/v1
id: ai-sdk-otel-needsapproval-no-execute-tool-span
title: ai-sdk-otel-needsapproval-no-execute-tool-span
createdAt: 2026-07-03T20:16:57+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ai-sdk-otel-needsapproval-no-execute-tool-span.md
  commit: e842f5e0d2544cd1091af51a10a0c0c490f2458d
description: "@ai-sdk/otel 不给 needsApproval:true 的工具在批准后的真实执行产 execute_tool 类型 span——当年靠 span 派生事件的接法因此断不中这类工具;普通工具不受影响。span→事件派生这套 API 已整体撤除,gap 现在够不着断言"
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

> **API 时效(2026-07-24 复核)**:本条的现象与当年的修法都发生在「OTel span 派生
> `StreamEvent`」那套接法下(当时写法 `events: otelEvents({ dialects: [otel.genAi] })`)。
> **这套 API 已从仓库整体撤除,没有等价替代品**——见 `docs-otel-mixin-not-implemented.md`。
> 现在的契约是 **span 从不产出、也从不改写任何 `StreamEvent`**,断言只读 `send` 返回的
> `Turn.events`(`docs/observability.md`「OTLP traces → 统一瀑布图」)。所以下面涉及
> `otelEvents` / 方言的部分是历史片段,**用当前 API 表达不出来,别照抄成代码**;上游
> `@ai-sdk/otel` 的插桩缺口本身仍是真的,只是现在够不到断言那条链。

**现象**:`examples/zh/tier1/ai-sdk-v7`(黑盒 HTTP 接 AI SDK v7,当时事件来源是 OTel span
派生的 genAi 方言)跑 `hitl-approve.eval.ts`——`calculate` 工具声明了 `needsApproval: true`,
approve 之后模型确实拿到了正确的计算结果(assistant 回复"计算结果是 126"),但
`t.calledTool("calculate", {status:"completed"})` 断言失败,`niceeval` 报告这一轮"0 tools"。
同一个 eval 套件里 `get_weather`(没有 `needsApproval`)的 `calledTool` 断言完全正常。

**根因**:抓 `.niceeval/*/hitl-approve/*/trace.json` 发现,resume(approve)那一轮实际收到的
3 个 span 是 `invoke_agent` / `chat` / `agent_step`(`gen_ai.operation.name` 分别是
`invoke_agent`/`chat`/`agent_step`),**没有一个 `gen_ai.operation.name === "execute_tool"`
的 span**——`calculate` 的真实执行结果(`126`)只是作为 `chat` span 的
`gen_ai.input.messages` 里一条 `tool_call_response` 内容出现,从没有被单独打成一个工具执行
span。当时的 genAi 方言(住在 `src/o11y/otlp/dialects.ts`,该文件已随整套派生 API 一起删除)
只在 `op === "execute_tool"` 时才派生 `action.called`/`action.result`,既然没有这个 span,
派生结果就是空。这不是 niceeval 的映射 bug,是 `@ai-sdk/otel`(官方 GenAI semconv 集成)对
`needsApproval` 这条 resume-after-approval 路径确实没有插桩——普通(无审批门)工具走的是常规
tool-call 循环,`execute_tool` span 完全正常。

deny 分支还有一层更彻底的缺失:被拒绝的调用**根本不会真的执行**,`execution-denied` 结果是
在 `convertToModelMessages` 转换历史时合成进 `ModelMessage`(角色 `tool`,
`output:{type:"execution-denied", reason}`)喂给模型的,连一条 SSE `tool-output-*` chunk 都
不会有——如果指望"从这一轮的原始帧里翻出 denied 事件",翻遍整条流也翻不到,唯一的信息源是
adapter 自己在决定 approve/deny 那一刻手上已有的数据(`toolCallId`/`name`/`input`)。这一条
和数据源无关,协议层就是这样,至今成立。

**当年的修法(接法已作废,只留结论)**:`examples/zh/tier1/ai-sdk-v7/agents/ai-sdk-v7.ts` 当时
维护一张 gated 工具白名单(`GATED_TOOLS = new Set(["calculate"])`),在 HITL 续跑分支手动补
`action.called`/`action.result`——deny 时两条都在决定的当下直接手写(不等任何帧);approve 时
先手写 `action.called`,再从 SSE 里等 `tool-output-available`(toolCallId 匹配)补上
`action.result(status:"completed")`。要点是**用真实协议里的 `toolCallId` 而不是自造 id**,
这样手动补的记录和"万一某天 @ai-sdk/otel 也给 execute_tool span 打上了"的派生结果天然对得上,
不产生幽灵重复。这段代码连同它依赖的派生 API 一起没了,不要去 example 里找。

**现在怎么做(当前 API 的真实落点)**:

- `examples/zh/tier1/ai-sdk-v7/agents/ai-sdk-v7.ts` 与 `tier2/` 那份都已改用内置
  `uiMessageStreamAgent`(`niceeval/adapter` 导出,`src/agents/ui-message-stream.ts`):
  事件从 UI Message Stream **协议帧直构**,不碰 span,所以这条 gap 从根上够不着断言。
  approve/deny 的工具对由 `deriveTurnEvents`(`src/agents/ui-message-stream.ts:174`)从消息
  parts 合成——停在 `approval-requested` 的 part 不报 `called`(还没执行),裁决落地那一轮才
  按 `output-available` / `output-error` / `approval-responded(approved:false)` 落成
  `completed` / `failed` / `rejected`。
- deny 时给模型一句"别重试"的理由是内置默认行为:`UiMessageStreamAgentOptions.denyReason`
  (`src/agents/ui-message-stream.ts:224`),不传时用 `DEFAULT_DENY_REASON`(同文件 `:233`,
  "用户拒绝了这次调用,不要重试,直接告知用户操作未执行。")。当初手工加这句是因为
  `@ai-sdk/openai` 会把 reason 原样转成模型看到的工具结果文本,不给就是泛泛的
  `"Tool call execution denied."`——写清楚"别重试"能明显降低模型重新发起同一个调用的概率
  (deepseek-v4-flash 复现过这个"被拒绝一次还要再试一次"的行为,和 claude-sdk / langgraph
  接入时观察到的一致)。这条结论被吸收成了默认值。
- BatchSpanProcessor 调度延迟(span 在流已经结束、连接已关之后才导出)在这个应用上也复现过,
  和 `langsmith-dialect-langchain-completion-shape-gap.md` 记的 langgraph 那次是同一个原因、
  同一个修法,不是这个应用特有的。现在这只影响瀑布图、不影响断言,表达方式是
  `uiMessageStreamAgent({ settleMs })`(`src/agents/ui-message-stream.ts:226`,消费点 `:373`)
  配应用启动时的标准环境变量 `OTEL_BSP_SCHEDULE_DELAY`——`examples/zh/tier2/ai-sdk-v7/agents/ai-sdk-v7.ts`
  就是这个组合(`settleMs: 600`)。

**适用场景**:以后接其它声明了 `needsApproval`/审批门的 AI SDK v7 应用,别从 span 里找工具执行
证据(现在也没有这条路),直接走协议帧;如果哪天有人试图重新做"span 派生事件",记得
`needsApproval` 的 resume 路径是上游插桩的盲区,不是自己漏配了什么。
