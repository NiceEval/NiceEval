# 主流 agent loop 的接入面调研 —— API / 会话 / HITL / 遥测

**来源:** 各框架官方文档 / 源码(2026-07 抓取,URL 见各节)。这是**调研记录**:如果要把「用这些框架写的 agent」接进 niceeval,每家的 API 面和遥测面长什么样。和两篇姊妹调研对照着读:[otel-genai.md](otel-genai.md) 讲「记录 agent 行为的 schema 标准」,[otel-instrumentation.md](otel-instrumentation.md) 讲「应用侧现成 OTel 埋点里有什么数据」;本篇讲**框架原生 API 本身**。

覆盖四家:OpenAI Agents SDK、Claude Agent SDK、LangGraph、pi。AI SDK 不重复(已是内建 adapter,见 [行为与 Trace 采集](../architecture/collection.md)),但列进末尾对照表。

## OpenAI Agents SDK(`openai-agents` / `@openai/agents`)

- **调用面**:`Runner.run(agent, input)` → `RunResult`。`final_output`(有 `output_type` 时是结构化对象)、`new_items: RunItem[]`(类型闭集:`MessageOutputItem` / `ReasoningItem` / `ToolCallItem` / `ToolCallOutputItem` / `ToolApprovalItem` / `HandoffCallItem` / `HandoffOutputItem`)、`raw_responses`、四组 guardrail results。**`ToolCallItem` / `ToolCallOutputItem` 都暴露 `call_id`,显式配对**。handoff 本质是名为 `transfer_to_<agent>` 的特殊 tool call。
- **流式**:三类事件——`RawResponsesStreamEvent`(透传 Responses API 原始事件)、`RunItemStreamEvent`(item 完整生成,`name` 语义化:`message_output_created` / `tool_called` / `tool_output` / `handoff_requested` / `handoff_occured`〔Python 侧是官方保留的拼写错误〕/ `reasoning_item_created` …)、`AgentUpdatedStreamEvent`(handoff 换 agent)。
- **会话**:四种续接——手动 `result.to_input_list()`;`session=`(SQLite / Redis / OpenAI Conversations 等多实现,自定字符串 id);服务端 `conversation_id`;`previous_response_id` 链式。原生 session id 概念齐全。
- **HITL**:工具声明 `needs_approval=True` → run 暂停,`result.interruptions` 给 `ToolApprovalItem[]`;`state.approve(...)` / `state.reject(...)` 后 `Runner.run(agent, state)` 恢复;`RunState` 可 `to_json()` 序列化跨进程。JS 先有,Python 0.17.x 已补齐(0.7 还没有,接旧版本要注意)。
- **遥测**:内置 tracing 是**私有类型化 span 树**(`agent_span` / `generation_span` / `function_span` / `handoff_span` / `guardrail_span`),默认导出到 OpenAI 后端;**`trace_include_sensitive_data` 默认 `true`**(LLM/工具输入输出默认记录)。SDK 无原生 OTLP exporter;OTel 路线是官方 contrib 的 `opentelemetry-instrumentation-openai-agents-v2`(产 **gen_ai semconv** span,内容由 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 控制,默认不采)或 20+ 第三方 processor(Logfire / Langfuse / Braintrust …)。
- **usage**:`result.context_wrapper.usage`(全 run 聚合:requests / input / output / total + cached/reasoning 细分 + 逐请求明细)。
- 来源:https://openai.github.io/openai-agents-python/{running_agents,results,streaming,sessions,human_in_the_loop,tracing,usage} 、https://openai.github.io/openai-agents-js/guides/ 、https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation-genai/opentelemetry-instrumentation-openai-agents-v2

## Claude Agent SDK(`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`)

- **调用面**:`query({ prompt, options })` → `AsyncGenerator<SDKMessage>`。SDKMessage 联合类型已膨胀到 ~28 个成员(核心:`assistant` / `user` / `result` / `system:init` / `stream_event` / `compact_boundary`,外加大量运维型消息),**adapter 要按 type/subtype 白名单过滤**。tool_use 是 assistant 消息 `content` 里的标准 Anthropic 块(`{ type: "tool_use", id, name, input }`),结果以 user 消息的 `tool_result` 块回流,**`tool_use.id ↔ tool_result.tool_use_id` 显式配对**;`parent_tool_use_id` 标记 subagent 归属。`result` 消息一次给全:`result` 文本、`structured_output`(有 output schema 支持,校验失败自动重试)、`usage` / `modelUsage` / `total_cost_usd`(客户端估算)、`num_turns`、`permission_denials`(被拒工具清单)、`terminal_reason`。
- **会话**:`resume: <session_id>` / `continue: true` / `forkSession: true`(复制历史开新线,同起点分支实验直接可用)/ `resumeSessionAt: <uuid>`。transcript 落盘 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`,且有官方读取 API(`listSessions()` / `getSessionMessages()`)——**采集可以不自己录**。V2 会话 API(`unstable_v2_*`)已在 TS SDK 0.3.142 移除。
- **HITL**:两档。同进程 `canUseTool(toolName, input, { toolUseID })` 回调,返回 allow(可改写 input)/ deny——官方明说**可以无限期挂起**,execution 一直等回调返回;跨进程用 `PreToolUse` hook 返回 `permissionDecision: "defer"` → 进程退出、result 带 `stop_reason: "tool_deferred"` + `deferred_tool_use`,之后同 session_id resume。权限评估固定六步(hooks → deny 规则 → ask 规则 → mode → allow 规则 → canUseTool),**被前面步骤 auto-approve 的调用永远到不了 `canUseTool`**。
- **遥测**:SDK 不产遥测,透传 env 给 CLI;CLI 内置 OTel 三信号独立开关——metrics、logs/events、**traces(beta,需 `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`)**。span 树 `claude_code.interaction` → `claude_code.llm_request` / `claude_code.tool`(内含 `tool.blocked_on_user` 等人审批时段单独成 span)。schema 是**私有 `claude_code.*` 掺部分 gen_ai semconv**(`gen_ai.request.model`、tool span 上有 `gen_ai.tool.call.id`)。**内容默认脱敏**,`OTEL_LOG_TOOL_CONTENT=1` / `OTEL_LOG_RAW_API_BODIES=file:<dir>`(原始 API body 落盘,最完整采集通道)按需开。支持 W3C trace context 传播(harness 的 span 可当 agent trace 的父节点)。
- **usage 坑**:并行 tool call 会产生多条共享同一 `message.id` 且 usage 相同的 assistant 消息,**必须按 id 去重**否则重复计数。
- 来源:https://code.claude.com/docs/en/agent-sdk/{typescript,sessions,permissions,user-input,observability,cost-tracking,structured-outputs}

## LangGraph(Python / JS)

- **调用面**:`graph.invoke(state, config)` → 最终 state dict。messages 通道上 `AIMessage.tool_calls[]` 带 `id`,`ToolMessage.tool_call_id` 必填——**显式配对**。
- **流式**:两套并存。图级 `stream_mode`(Python 7 种:`values` / `updates` / `messages` / `custom` / `checkpoints` / `tasks` / `debug`;JS 另有 `tools`);组件级 `astream_events` / `streamEvents` v2(`on_chat_model_start|stream|end`、`on_tool_start|end`、`on_chain_*`,带 `run_id` + `parent_ids` 树坐标)。v3 typed 事件流 beta。
- **会话**:checkpointer + `config.configurable.thread_id`,原生 session id 语义;`checkpoint_id` 提供时间旅行(从历史 checkpoint 分叉)。
- **HITL**:节点内 `interrupt(payload)` → invoke 返回值带 `__interrupt__` key(`Interrupt { value, id }`);以同 thread_id 用 `Command(resume=value)` 再 invoke 恢复;多个并发 interrupt 用 `{interrupt.id: answer}` dict 一次 resume。**resume 后节点从头重放**(`interrupt()` 之前的代码再跑一遍)——eval 采集会看到中断前副作用重复出现。
- **遥测**:**零依赖 OTLP 路线是四家里最顺的**——`LANGSMITH_TRACING=true` + `LANGSMITH_OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT=<任意端点>`(`LANGSMITH_OTEL_ONLY=true` 完全绕开 LangSmith 后端)。但 span 属性是**混合方言**:gen_ai(OpenLLMetry 风格旧写法 `gen_ai.completion.0.content`)+ OpenInference(`openinference.span.kind`)+ Traceloop 属性并存,消费端不能只按单一 semconv 解析。OpenInference / OpenLLMetry 也各有 langchain instrumentation(hook 在 langchain-core 上,LangGraph 自动覆盖)。
- **usage**:`AIMessage.usage_metadata`(input/output/total + cache/reasoning 细分);跨调用聚合用 `UsageMetadataCallbackHandler`。已知坑:`stream_mode="messages"` 下 usage 可能缺(langgraph#5951)。
- 来源:https://docs.langchain.com/oss/python/langgraph/{streaming,persistence,interrupts} 、https://docs.langchain.com/langsmith/trace-with-opentelemetry

## pi(earendil-works/pi,原 badlogic/pi-mono)

- **定位**:「minimal terminal coding harness」。默认 4 工具(`read` / `write` / `edit` / `bash`)、~1000 token 系统提示、无 sub-agent / plan mode / MCP(明确立场)。npm scope 已从 `@mariozechner/*` 迁到 `@earendil-works/*`(旧包全部 deprecated;`@mariozechner/pi` 本身是 vLLM 部署工具,**不是** coding agent,别装错)。
- **调用面**:四种运行模式全部官方支持——interactive、`--mode json`(事件 JSONL 打 stdout)、`--mode rpc`(stdin/stdout 双向 JSONL,支持 `id` 请求关联)、SDK 进程内(`createAgentSession()` + `session.subscribe()` + `session.prompt()`)。
- **事件流**:词汇闭集,层级清晰——`agent_start/end`、`turn_start/end`(**turn 概念显式**)、`message_start/update/end`(内嵌 text/thinking delta)、`tool_execution_start/update/end`(**均带显式 `toolCallId`** + args,end 带 result + isError)、`compaction_start/end`、`auto_retry_start/end`。工具结果双通道:`content` 给 LLM、`details` 给 UI(如 edit 工具的 `details.diff` 是标准 unified patch)。
- **会话**:JSONL **树**结构(首行 SessionHeader v3,条目带 `id` + `parentId`,同文件内原地分支),存 `~/.pi/agent/sessions/`;`AssistantMessage` **自带 usage(含 cache 细分)+ 分项 cost + stopReason + provider + model**——对 eval 采集是四家里最友好的 transcript。SDK 侧 `SessionManager.inMemory()` 可不落盘;`fork()` / `importFromJsonl()` 齐全。
- **HITL**:**无内置工具审批**(哲学是 YOLO + 可观测)。要拦得用 extension:`pi.on("tool_call", handler)` 返回 `{ block: true }`,`ctx.ui.confirm/select/input` 与人交互;RPC 模式有 extension UI 协议转发对话框。
- **遥测**:**今天没有**。`packages/agent/docs/observability.md` 有设计稿(自发结构化生命周期事件、不依赖 OTel、外部监听者自行转 span),但源码搜索确认未实现。现实遥测面 = 事件流 + AssistantMessage 自带的 usage/cost。
- 来源:https://github.com/earendil-works/pi (README + packages/coding-agent/docs/{sdk,json,rpc,session-format,extensions}.md + packages/agent/docs/observability.md)、https://mariozechner.at/posts/2025-11-30-pi-coding-agent/

## 汇总对照(含 AI SDK 作参照)

| | 调用面 | call/result 配对 | 原生会话 | HITL 原语 | 原生遥测 |
|---|---|---|---|---|---|
| **AI SDK**(v7) | `generateText` → steps/content parts | `toolCallId` | 无(自管 messages) | `needsApproval` → `tool-approval-request` 停轮 | `experimental_telemetry`:`ai.*` 私有 + 部分 gen_ai(见 [otel-instrumentation.md](otel-instrumentation.md)) |
| **OpenAI Agents SDK** | `Runner.run` → `RunResult.new_items`(item 类型闭集) | `call_id` | `to_input_list` / Sessions / `conversation_id` | `needs_approval` → `interruptions` + `RunState.approve/reject`(可序列化) | 私有 span 树(敏感数据**默认采**);OTel 走官方 contrib(gen_ai,内容 opt-in) |
| **Claude Agent SDK** | `query()` → `SDKMessage` 流(~28 种,需白名单) | `tool_use.id ↔ tool_result.tool_use_id` | `resume` / `forkSession` + jsonl 落盘 + 官方读取 API | `canUseTool` 回调(可无限挂起)/ `defer` + resume | CLI 内置 OTLP 三信号,traces beta;`claude_code.*` 掺 gen_ai;内容 opt-in |
| **LangGraph** | `invoke(state)` → 最终 state | `tool_calls[].id ↔ tool_call_id` | `thread_id` + checkpointer(+时间旅行) | `interrupt()` → `__interrupt__` + `Command(resume)`;节点重放 | `LANGSMITH_OTEL_ENABLED` → 任意 OTLP;**三方言混合** |
| **pi** | SDK subscribe / `--mode json` / RPC | `toolCallId` | JSONL 树 + fork;可 inMemory | 无内置;extension `tool_call` 拦截 | 无(仅设计稿) |

## 对 niceeval 的印证与启发

1. **五档契约的原语每家都有对应物,写 converter 是机械工作。** 显式 call id 配对(全员)、原生 session id(全员)、HITL 停轮-恢复(pi 之外全员)——niceeval 的 `Turn` / `StreamEvent` / `waiting + input.requested` / `ctx.session` 在每家都能一一映射,没有语义鸿沟。真正贵的不是"能不能写",是 **N 家 × 版本漂移的维护**:内建 `fromAiSdk` 530 行里,近半是 v4/v5/v7 字段漂移兜底和 approval 形状适配,每家都这样写一份不可持续。
2. **HITL 有三种形态,niceeval 的握手能表达全部,但回调型要搭桥。** 停轮返回型(AI SDK / OpenAI Agents:结果里带 interruptions,天然对应 `waiting` + 下轮 resume)最好接;**回调挂起型**(Claude `canUseTool`、pi extension)是"execution 停在 await 上",adapter 要把回调转成 promise 桥——本轮 send 存住 pending resolver 返回 `waiting`,下轮 send 拿 `t.respond` 的回答去 resolve 它,进程内可行但要小心超时;异常-重放型(LangGraph `interrupt`)注意 **resume 后节点从头重跑**,事件流会出现中断前动作的重复,转换层要按 interrupt id 去重。
3. **会话义务通常是一行透传,fork 是意外之喜。** `thread_id` / `resume <session_id>` / Sessions 直接对接 `ctx.session.id`;Claude 的 `forkSession` 和 pi 的树形 session 还支持"同起点分支"——将来 niceeval 若做同 prompt 多分支对比,这两家有原生原语。
4. **遥测面四家四样,"等一个统一标准"不现实。** 私有 schema(OpenAI Agents)、私有掺 gen_ai(Claude)、三方言混合(LangGraph)、没有(pi)。但共性是**都能把 span 说到任意 OTLP 端点**(原生 env / 官方 instrumentation / 第三方埋点),而且第三方埋点生态的内容默认全采(见 [otel-instrumentation.md](otel-instrumentation.md))——归一的活落在接收侧,这正是 niceeval 已有的 canonical mapper 结构(每方言一个薄 mapper)能吃下的形状。
5. **transcript 侧仍然不可替代,而且有的框架比 OTel 侧更全。** Claude 的 jsonl + 官方读取 API、pi 的自带 usage/cost 的树形 JSONL,都比各自的遥测通道信息更全、更稳(Claude traces 还在 beta)。接这两家优先 transcript,OTel 只补 trace——与 [observability.md](../../../observability.md) 的双轨结论一致。

## 相关阅读

- [otel-instrumentation.md](otel-instrumentation.md) —— 应用侧现成 OTel 埋点里有什么数据(mixin 可行性的证据)。
- [otel-genai.md](otel-genai.md) —— 记录 agent 行为的 schema 标准对照(OTel GenAI / OpenInference / AG-UI …)。
- [Observability · OTLP traces](../../../observability.md#otlp-traces-统一瀑布图) —— OTel 在当前设计里的实际角色(只画瀑布图,不产出事件)。
- [标准事件模型](../architecture/events.md) —— 这些原语要映射到的目标形状。
