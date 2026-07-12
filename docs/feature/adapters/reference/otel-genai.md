# OTel GenAI 与其它「agent 行为怎么记」的标准(调研记录)

**来源:** OpenTelemetry 官方文档 / [semantic-conventions-genai 仓库](https://github.com/open-telemetry/semantic-conventions-genai)、各标准官方 spec(2026-07 抓取)。这是**调研记录**,和 [agent-eval 笔记](agent-eval.md)对照着读:同一个问题——"agent 干了什么,用什么 schema 记下来"——agent-eval 选择**自己定义一套闭集事件类型**,OTel GenAI 是**行业标准的另一套**。本篇记录 OTel GenAI 到底定义了什么、还有哪些标准在解决同一问题、以及这些对 niceeval 的 `StreamEvent` / trace 双轨设计意味着什么。

niceeval 自己的选择已经定了(见 [Observability](../../../observability.md#otlp-traces--统一瀑布图)):**断言走自定义 `StreamEvent[]`,trace 归一到 OTel GenAI semconv,不发明私有 trace schema**。本篇是这个决定背后的对照材料。

## 问题的两条路线

| | agent-eval(自定义) | OTel GenAI(标准) |
|---|---|---|
| 载体 | 扁平 JSON 事件数组(`TranscriptEvent[]`),无时间层级 | span 树(带起止时间、父子嵌套)+ 属性 + 事件 |
| 类型集 | 自定闭集:`message` / `tool_call` / `tool_result` / `thinking` / `error` | `gen_ai.operation.name` 枚举 + `gen_ai.*` 属性命名空间 |
| call/result 配对 | 无 id,靠顺序假设(并发会错配) | `gen_ai.tool.call.id` 显式配对 |
| 工具名 | 自建 canonical `ToolName` 映射表(每 agent 一份) | 保留原名(`gen_ai.tool.name`),**不做跨 agent 归一** |
| 消息内容 | transcript 全量保留(离线评测需要) | **opt-in**(敏感数据顾虑,默认不采) |
| 服务的场景 | 离线断言 / 评分 | 线上可观测 / APM 后端 |

这两条路线不是竞争关系,是**场景不同**:eval 需要"完整、可断言的行为记录",可观测需要"标准、可跨系统聚合的遥测"。niceeval 两者都要,所以双轨。

## OTel GenAI 定义了什么

原本在 semantic-conventions 主仓库,2025 年后迁到独立仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)(YAML model 生成 markdown,用 Weaver 管理对核心 semconv 的依赖)。**整体仍是 Development 状态**——键名可能变,做 mapper 时要留升级余量。参与方包括 Amazon、Elastic、Google、IBM、Microsoft。

### Spans(核心)

推理 span:`gen_ai.operation.name` = `chat` / `text_completion` 等,配 `gen_ai.request.model`、`gen_ai.request.temperature`、`gen_ai.usage.input_tokens` / `output_tokens`。

工具执行 span:`gen_ai.operation.name = "execute_tool"`,配 `gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.tool.description`、`gen_ai.tool.type`。

**agent spans**(比 niceeval [observability.md 的 kind 映射表](../../../observability.md#canonical-目标--opentelemetry-genai-语义约定不发明私有-schema)收录的更多,mapper 可按需扩展):

| `gen_ai.operation.name` | span 命名 | 含义 |
|---|---|---|
| `create_agent` | `create_agent {gen_ai.agent.name}` | 创建(远程)agent |
| `invoke_agent` | `invoke_agent {gen_ai.agent.name}` | 调用 agent(分 client / internal 两种形态) |
| `invoke_workflow` | `invoke_workflow {gen_ai.workflow.name}` | 多 agent 编排的一次工作流 |
| `plan` | `plan {gen_ai.agent.name}` | agent 的规划 / 任务分解阶段 |

agent span 的必填属性是 `gen_ai.operation.name`(+远程形态的 `gen_ai.provider.name`);有值就填 `gen_ai.agent.name` / `gen_ai.agent.id`;消息内容(`gen_ai.input.messages` / `gen_ai.output.messages`)、`gen_ai.tool.definitions`、`gen_ai.system_instructions` 都是 **opt-in**。

### Events(输入输出的全量记录)

**没有** per-message 事件(早期草案的 `gen_ai.user.message` / `gen_ai.assistant.message` 那套已废)。现在只有两个事件:

- `gen_ai.client.inference.operation.details` —— 一次补全的完整细节(聊天历史 + 参数),opt-in,"可以独立于 trace 存储输入输出"。消息体里工具调用是结构化 part:`{ "type": "tool_call", "id", "name", "arguments" }`,响应是 `{ "type": "tool_call_response", "id", … }` —— **也是显式 id 配对**。
- `gen_ai.evaluation.result` —— 评测结果(质量 / 准确性打分)。OTel 自己也在往 eval 场景伸手,值得持续关注。

### 其它

- **MCP conventions**(`mcp.*` 命名空间):MCP 调用怎么记 span。coding agent 普遍带 MCP,以后 mapper 可能用上。
- **Provider-specific**:anthropic / openai / aws-bedrock / azure-ai-inference 各有一页扩展属性(`openai.*` 等)。
- **Metrics / Exceptions**:请求量、时延、token 计数等聚合指标;异常记法。

## 其它标准:同一个问题的更多答案

### OpenInference(Arize Phoenix)—— span kind 分类学最全

OTel 兼容的另一套约定,核心是每条 span 必带 `openinference.span.kind`,枚举比 OTel GenAI 的 operation.name 丰富得多:`LLM` / `TOOL` / `CHAIN` / `AGENT` / `RETRIEVER` / `RERANKER` / `EMBEDDING` / `GUARDRAIL` / `EVALUATOR` / `PROMPT`。消息不走事件,**打平成索引属性**:`llm.input_messages.<i>.message.role` / `.content`;工具调用带 `tool_call.id` + `tool_call.function.name` / `.arguments`;token 与成本:`llm.token_count.prompt|completion|total`(含 cache read/write 细分)、`llm.cost.prompt|completion|total`(USD)。多模态内容有 `message_content.type`(`text` / `image` / `audio` / `reasoning` / `tool_use`)。

对照价值:`GUARDRAIL` / `EVALUATOR` / `RERANKER` 这些 kind 说明"span 语义角色"的枚举可以比 niceeval 现在的 `turn | model | tool | agent | other` 细;`llm.cost.*` 直接把成本进 trace,niceeval 是在 runner 侧按价格表算的(`src/runner/pricing.ts`),两种放法。

### OpenLLMetry(Traceloop)—— gen_ai.* 的前身推手

同样是 OTel 扩展,历史意义大于当下差异:它早期的 `llm.*` 属性实践直接推动了 OTel GenAI `gen_ai.*` 的标准化,现在基本向 gen_ai 收敛。另有一层实体 span(workflow / task / agent / tool)描述应用结构。可以当作"社区实现先行、再被标准吸收"的案例——niceeval 的 mapper 归一到 gen_ai 而不是任何厂商方言,就是押这个方向。

### OpenAI Agents SDK traces —— 带类型的私有 span 树

自己的一套(可经 processor 导出到 OTel 系后端):`Trace{ workflow_name, trace_id, group_id }` + 强类型 span:`agent_span` / `generation_span` / `function_span`(工具调用)/ `handoff_span` / `guardrail_span` / `transcription_span` / `speech_span` / `custom_span`。两个值得记的点:**`handoff_span` 是它独有的语义**(agent 间移交,OTel 里只能拿 `invoke_agent` 近似);**敏感数据是开关**(`RunConfig.trace_include_sensitive_data` 控制 generation/function span 是否含输入输出)——和 OTel 把消息内容做成 opt-in 是同一个顾虑的不同解法。

### AG-UI —— 和 niceeval `StreamEvent` 同形态的扁平事件流

前面几个都是 trace(span 树);AG-UI 不是 telemetry,是 **agent ↔ 前端的流式事件协议**,但它的形态和 niceeval 的 `StreamEvent[]` 最像:扁平事件序列 + 显式 id 配对。事件词汇:生命周期 `RunStarted` / `RunFinished` / `RunError` / `StepStarted|Finished`;消息三段式 `TextMessageStart`(定 `messageId` + role)→ `TextMessageContent`(delta)→ `TextMessageEnd`;工具调用镜像同构 `ToolCallStart`(定 `toolCallId` + name)→ `ToolCallArgs`(delta)→ `ToolCallEnd` → **`ToolCallResult`**;另有状态同步(`StateSnapshot` / `StateDelta`,RFC 6902 JSON Patch)和 `Reasoning*` 系列。

对照价值:**又一个用显式 id(`toolCallId`)配对 call/result 的设计**;它把"流式增量"(start/content/end 三段式)做进了词汇,而 niceeval 的 `StreamEvent` 是事后整段的——评测离线跑,不需要增量,这是场景差异不是缺陷。若将来 view 要做"实时看 agent 跑",AG-UI 是现成参考。

### Langfuse —— trace + 观测树,建在 OTel 上

LLM 工程平台的数据模型:`Trace`(一次请求)+ 嵌套 `Observation`(span / generation / event 几类),外加 `Session`(聚合多 trace 的多轮会话)和 `Score`(评分挂到 trace/observation 上)。底层已改为 OTel。对照价值:它的 `Session → Trace → Observation` 三层和 niceeval 的 `run → session → turn → events` 作用域链是同构的;`Score` 挂在任意层的设计对应 niceeval "断言作用域由接收者决定"。

## 汇总对照

| 标准 | 形态 | 工具调用配对 | 消息内容 | 工具名归一 | 状态 |
|---|---|---|---|---|---|
| agent-eval(自定义) | 扁平事件数组 | **顺序假设,无 id** | 全量 | 自建 canonical 表 | 私有 |
| [eve `HandleMessageStreamEvent`](eve-protocol.md) | **扁平事件流**(带 sequence / turnId / stepIndex 坐标) | `callId` | 全量(流式 delta) | 无需(自有运行时) | 私有,显式版本号(v16) |
| OTel GenAI | span 树 + opt-in 事件 | `gen_ai.tool.call.id` | opt-in | 无(保留原名) | Development |
| OpenInference | span 树(打平属性) | `tool_call.id` | 打平进属性 | 无 | 稳定使用中 |
| OpenLLMetry | span 树 | 同 gen_ai | 可配 | 无 | 向 gen_ai 收敛 |
| OpenAI Agents SDK | 私有类型化 span 树 | function_span 内 | 开关控制 | 无 | 私有,可导出 |
| AG-UI | **扁平事件流** | `toolCallId` | 全量(流式 delta) | 无 | 协议 v1 |
| niceeval `StreamEvent` | **扁平事件流** | `callId` | 全量 | `tool: ToolName` | 本仓库 |

## 对 niceeval 的印证与启发

1. **显式 id 配对是共识,agent-eval 是孤例。** OTel(`gen_ai.tool.call.id`)、OpenInference(`tool_call.id`)、AG-UI(`toolCallId`)、OTel 事件体(`tool_call` / `tool_call_response` 的 `id`)全部显式配对;只有 agent-eval 靠顺序。niceeval `StreamEvent` 的 `callId` 站在多数这边(契约纪律见 [Adapter 契约](../contract.md#标准事件流))。
2. **工具名跨 agent 归一是 eval 特有的需求,没有任何标准替你做。** 所有标准都保留原始工具名——它们的用户只看自己一个系统,不需要"Claude 的 `Bash` 和 Codex 的 `shell` 是同一件事"。要写 `calledTool("shell")` 这种跨 agent 断言,canonical `ToolName` 映射表(agent-eval 先做,niceeval 沿用)必须自己维护,这层没法外包给标准。
3. **"拿 OTel 当唯一数据源"不可行,transcript 侧不可替代。** OTel 把消息内容、工具入参这些 eval 最需要断言的东西做成 opt-in(线上敏感数据顾虑);我们又不控制 agent 的 instrumentation(coding agent CLI 发什么是什么)。所以断言数据源必须走 transcript → `StreamEvent[]`,trace 只补"各花了多久、谁套谁"——双轨不是冗余,是两个 schema 各自只解决一半问题。
4. **mapper 的归一目标可以逐步加宽。** agent spans 新增了 `invoke_workflow` / `plan`,provider 页和 `mcp.*` 在增长;OTel 自己出了 `gen_ai.evaluation.result` 事件。niceeval 的 `SpanKind` 现在收 `turn | model | tool | agent | other` 够用,将来要区分 plan / handoff / guardrail 时,先看标准里有没有现成词,别自造。
5. **semconv 仍是 Development,mapper 要按"键名会变"来写。** 归一逻辑集中在每 agent 一个薄 mapper 里(而不是散在 view / select),正是为了键名漂移时只改一处——这个仓库结构决定(见 [Observability](../../../observability.md#每个-agent-一个薄-mapper))被"标准还没稳"进一步坐实。

## 相关阅读

- [agent-loop-apis.md](agent-loop-apis.md) —— 四个主流 agent loop 的原生 API 面(这些标准的生产者侧)。
- [otel-instrumentation.md](otel-instrumentation.md) —— 应用侧埋点里内容默认采不采(数据可得性)。
- [agent-eval 笔记](agent-eval.md) —— 自定义路线的具体实现(采集 / 转换 / 落地、顺序配对的坑)。
- [Observability](../../../observability.md) —— niceeval 的双轨:StreamEvent 断言 + canonical GenAI trace。
- [Adapter 契约](../contract.md) —— `StreamEvent` 词汇与逐断言的数据义务。
