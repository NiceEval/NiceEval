---
format: concord.document/v1
id: langsmith-dialect-langchain-completion-shape-gap
title: langsmith-dialect-langchain-completion-shape-gap
createdAt: 2026-07-03T20:16:57+08:00
createdAtSource:
  kind: first-recorded
  path: memory/langsmith-dialect-langchain-completion-shape-gap.md
  commit: e842f5e0d2544cd1091af51a10a0c0c490f2458d
description: 当年的 langsmith 方言解析不了 LangChain ChatOpenAI 实际吐的 gen_ai.completion
  形状(generations[0][0].text),message 事件恒空——方言连同整套 span 派生事件的 API
  已撤,现在消息只能从协议帧来;BatchSpanProcessor 收尾宽限那条修法仍在用
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

> **API 时效(2026-07-24 复核)**:本条的现象发生在「OTel span 派生 `StreamEvent`」那套接法下
> (当时写法 `events: otelEvents({ dialects: [otel.langsmith] })`,方言实现住
> `src/o11y/otlp/dialects.ts`)。**这套 API 与该文件已从仓库整体撤除,没有等价替代品**——见
> `docs-otel-mixin-not-implemented.md`。现在的契约是 **span 从不产出、也从不改写任何
> `StreamEvent`**,断言只读 `send` 返回的 `Turn.events`(`docs/observability.md`
> 「OTLP traces → 统一瀑布图」)。所以下面「方言解析不出消息文本」这个 gap **用当前 API
> 表达不出来了**,留作上游形状的记录;下半段的批处理时序修法则原样还在用。

**现象**:`examples/zh/tier1/langgraph`(真实 LangGraph + LangSmith OTEL_ONLY 导出,当时事件
来源是 span 派生的 langsmith 方言)跑 `weather-tool.eval.ts` 时,`t.calledTool("get_weather", ...)`
和 usage 都正确(工具断言、token 数全对),但 `t.messageIncludes(...)` 总是失败——`niceeval view` /
`events.json` 里完全没有 `{type:"message", role:"assistant"}` 事件,即使原始 SSE 帧
(`text-delta`)里模型确实吐了完整的自然语言回复(比如"北京今天天气不错哦！☀️ 当前**晴朗**,
气温 **26°C**...")。

**根因**:当时 `langsmith` 方言的 `kind === "llm"` 分支只认得 `gen_ai.completion` 三种形状:
纯字符串、`{content: string}`、或"消息数组"形状(`[{role, content}]`)。LangChain 的
`ChatOpenAI` 包装器实际吐的 `gen_ai.completion` 是
`{"generations":[[{"text": "...", "message": {...}, ...}]]}`——生成候选数组套一层
(`generations[0][0].text`),三种已知形状都不命中,`text` 解析成 `undefined`,消息事件直接吐空。
**这只影响 assistant 文本派生**,同一个 span 的 `gen_ai.usage.*` 属性走独立字段读取,usage 聚合
完全不受影响;工具调用走的是另一条分支,shape 对得上,`action.called`/`action.result` 也完全正常。
(这个"LangChain 包装器的 completion 形状比 semconv 多套两层"的观察对上游仍然成立,只是 niceeval
这边已经没有任何代码去读它了。)

另外一个相关但独立的现象:LangSmith 的 `OtelSpanProcessor` 是标准 `BatchSpanProcessor`(读
`OTEL_BSP_SCHEDULE_DELAY` 环境变量,默认 5000ms),"这一轮 HTTP 请求几时返回"和"批处理几时把
span 真正导出"是两条不对齐的时间线——即使把 `OTEL_BSP_SCHEDULE_DELAY` 调到 200ms,拿到工具
结果后生成最终自然语言回复的那次模型调用,它的 span 经常在 SSE 流已经吐完 `finish`、连接已经
关闭之后才真正被导出,niceeval 的本轮收集窗口这时已经关了。**这一条今天依然成立**,只是后果从
"断言断不中"降级成"瀑布图缺一段"。

**修法 / 适用场景**:

- 消息文本的部分,当年是"绕开 span 自己拼",今天是**唯一的路**:adapter 累积协议原生的
  `text-delta` 帧,轮次结束时 push 一条 `{type:"message", role:"assistant", text}`。现在的
  落点是 `examples/zh/tier1/langgraph/agents/langgraph.ts`——`drainStream` 里
  `case "text-delta"` 累进 `messageText`,`finalize()` / HITL 停轮处补出 message 事件;
  工具事件同理从 `tool-input` / `tool-output` / `tool-output-denied` 帧直构
  (`action.called` / `action.result(completed|failed)` / `action.result(rejected)`)。
  当年记的"和 span 派生结果按时间戳合并"那套机制随 `otelEvents` 一起没了,现在**不存在**
  事件与 span 的合并——span 只在展示层被 `buildExecutionTree(events, spans)` 叠成时间注释
  (`src/o11y/execution-tree.ts`),不反哺判分。
- usage 仍然可以来自 span,但走的是另一条正规通道:adapter 不报 usage 时,core 用
  `extractUsageFromSpans`(`src/o11y/derive.ts:190`)按 GenAI semconv 从 span 属性累加 token。
  这条一直在,和方言无关。
- 批处理时序那条修法原样保留,现在住在 Tier 2(Tier 1 的 langgraph 零 OTel 依赖):
  1. 启动被测应用时给标准环境变量 `OTEL_BSP_SCHEDULE_DELAY=200` 把批处理调度间隔调短
     (`examples/zh/tier2/langgraph/README.md:42` 的启动命令行里就是);
  2. adapter 在轮次真正结束后主动 `await` 一段收尾宽限,把收集窗口人为拉宽,让最后一批 span
     有时间落进来——`examples/zh/tier2/langgraph/agents/langgraph.ts:71` 的
     `OTEL_FLUSH_GRACE_MS = 600`,消费点在同文件 `:83`;
  3. 同一份 config 里 `telemetry: { port: 4318 }`(`examples/zh/tier2/langgraph/niceeval.config.ts:15`)
     钉住接收端口,并把 `ctx.telemetry?.headers` 的 traceparent 随请求带过去,span 归属才精确。
  内置工厂里对应的表达是 `uiMessageStreamAgent({ settleMs })`
  (`src/agents/ui-message-stream.ts:226`),同一个 `@ai-sdk/otel` 应用上也复现过同一时序问题,
  见 `ai-sdk-otel-needsapproval-no-execute-tool-span.md`。
- 以后要接其它走 `create_agent`/`ChatOpenAI` + LangSmith OTel 路线的黑盒应用:**别指望从 span
  里拿消息或工具证据**(现在也没这条路),事件一律从应用自己的流协议直构;span 只配来画瀑布图,
  配了就顺手把上面两条时序措施一起上。
