# 应用侧 OTel 埋点生态 —— span 里到底有没有 eval 要的数据(调研记录)

**来源:** 各生态官方文档 / spec / 源码(2026-07 抓取,URL 见各节)。**问题:** 如果被测 agent 已经接了 OTel(应用把 `OTEL_EXPORTER_OTLP_ENDPOINT` 指向 niceeval 起的本机接收器),能不能从 spans 里还原出「调了什么工具、入参出参、说了什么、用了多少 token」——这是评估"从 span 派生事件"这条路线是否可行的数据可得性调研(结论:不划算,niceeval 现在事件流一律走 `send`,OTel 只用来画 trace 瀑布图,见 [Observability](../../../observability.md#otlp-traces-统一瀑布图))。[otel-genai.md](otel-genai.md) 讲的是这些生态的 **schema 长什么样**;本篇只回答**内容默认采不采、字段在哪**。

## 结论先行

| 生态 | 工具入参/出参 | assistant 消息文本 | token | 内容默认状态 |
|---|---|---|---|---|
| **Vercel AI SDK** `experimental_telemetry` | `ai.toolCall.args` / `.result`(单属性直拿) | `ai.prompt.messages` / `ai.response.text` | `ai.usage.*` + 标准 `gen_ai.usage.*` | **默认全采**(`recordInputs/recordOutputs` 默认 true;telemetry 总开关 `isEnabled` 需应用自己开) |
| **OpenLLMetry**(Traceloop) | `gen_ai.{prompt,completion}.{i}.tool_calls.{j}.name/.arguments`(工具**执行结果**只在框架级埋点的 tool span 里有) | `gen_ai.prompt/completion.{i}.content` | `gen_ai.usage.*` | **默认全采**(`TRACELOOP_TRACE_CONTENT` 默认 true) |
| **OpenInference**(Arize) | `tool_call.function.name/arguments` + TOOL span 的 `input.value` / `output.value` | `llm.input_messages` / `llm.output_messages` | `llm.token_count.*`(含 cache/reasoning 细分) | **默认全采**(`OPENINFERENCE_HIDE_*` 是 opt-out,屏蔽值写 `__REDACTED__` 哨兵) |
| **OTel 官方 contrib** / gen_ai semconv | `gen_ai.tool.call.arguments/result`(**Opt-In**) | `gen_ai.input/output.messages`(**Opt-In**) | `gen_ai.usage.*`(Recommended,默认有) | **内容一律 opt-in,默认只有元数据 + token**(`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`) |

关键事实:**三个第三方生态内容默认全采、opt-out;只有 OTel 官方埋点默认不采。** 数据最全且最结构化的是 OpenInference(span kind 分类 + 工具/消息/token 全套);TS 应用最常见的现成埋点是 AI SDK 的 `ai.*`(工具入出参一个属性直拿)。

## 各生态细节

### Vercel AI SDK `experimental_telemetry`

- span 集:`ai.generateText`(根)→ `ai.generateText.doGenerate`(每次 provider 调用)、`ai.toolCall`(每次工具执行);streamText / embed 同构。
- `ai.toolCall` span:`ai.toolCall.name` / `.id` / `.args` / `.result`(执行成功且可序列化时)。**工具名、入参、出参默认全在**。
- 文本:根 span `ai.prompt` / `ai.response.text` / `ai.response.toolCalls`;doGenerate span `ai.prompt.messages`(发给 provider 的完整消息)。
- 命名空间:主体 `ai.*` 私有,但 doGenerate span 同时带标准 `gen_ai.system` / `gen_ai.request.*` / `gen_ai.response.*` / `gen_ai.usage.input_tokens` / `output_tokens`——**token 有标准名,内容只有私有名**。
- 来源:https://ai-sdk.dev/docs/ai-sdk-core/telemetry

### OpenLLMetry(Traceloop)

- 覆盖:OpenAI / Anthropic / Bedrock / Gemini 等 LLM SDK(Python+TS),LangChain / LlamaIndex / OpenAI Agents / CrewAI / LiteLLM 等框架(多为 Python-only),外加向量库和 MCP。
- 内容:官方原话 "By default, OpenLLMetry logs prompts, completions, and embeddings to span attributes";工具调用 flatten 成 `gen_ai.{prompt,completion}.{i}.tool_calls.{j}.id/.name/.arguments`(源码确认)。
- 注意:这套 `gen_ai.prompt/completion.{i}.*` 带索引写法已被最新 OTel GenAI semconv 标 deprecated(traceloop/openllmetry#3515 在迁移)——**采得全,但词汇是旧/自有的,接收侧要按 OpenLLMetry 方言解析**。
- 来源:https://www.traceloop.com/docs/openllmetry/{tracing/supported,privacy/traces,contributing/semantic-conventions}

### OpenInference(Arize)

- 覆盖面最广:Python 20+ 框架(OpenAI / Anthropic / **Claude Agent SDK** / LangChain / OpenAI Agents / PydanticAI / smolagents / MCP …);JS 含 OpenAI / Anthropic / LangChain.js / **Vercel AI SDK**(可把 `ai.*` span 转成 OpenInference 词汇)。
- 属性:`openinference.span.kind`(LLM / TOOL / AGENT / CHAIN …)+ `llm.input_messages` / `llm.output_messages` / `message.tool_calls.{i}.tool_call.function.name/.arguments` / `tool_call.id`;专门的 TOOL span 有 `tool.name` + `input.value` / `output.value`。
- 已知坑:langchain instrumentation 的 `input.value` / `output.value` 曾被写成 Python repr 而非 JSON(Arize-ai/openinference#2827),解析要容错。
- 来源:https://github.com/Arize-ai/openinference (spec/semantic_conventions.md、spec/tool_calling.md、spec/configuration.md)

### OTel 官方 contrib(instrumentation-genai)

- 现有 8 个包全部 development 状态:`openai-v2`、`anthropic`、`claude-agent-sdk`、`google-genai`、`vertexai`、`langchain`、`openai-agents-v2`、`weaviate`。LangGraph 无独立包(靠 langchain callbacks 覆盖)。
- 内容捕获:官方原话 "Message content such as … function arguments and return values are not captured by default";开启后可选 `span_only` / `event_only` / `span_and_event` 决定内容落 span 属性还是 log event。
- gen_ai semconv 本身仍全部 **Development**(独立仓库 semantic-conventions-genai);execute_tool span 的 `gen_ai.tool.call.arguments` / `.result` 要求级别 **Opt-In**。
- 来源:https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation-genai 、https://github.com/open-telemetry/semantic-conventions-genai

## OTLP 接收侧(进程内,不装 collector)

- OTLP/HTTP = POST `{endpoint}/v1/traces`,body 是 `ExportTraceServiceRequest`,`Content-Type` 二选一:`application/x-protobuf`(Node SDK 默认)或 `application/json`。应用侧 `OTEL_EXPORTER_OTLP_PROTOCOL=http/json|http/protobuf` 可切。
- OTLP/JSON 对 proto3 JSON mapping 有**规范级偏离**:`traceId` / `spanId` 是 **hex 字符串而非 base64**(spec 明文)——用通用 proto3 JSON 解析器会静默解错 ID。
- 响应契约:回 `ExportTraceServiceResponse`,且响应 Content-Type 要与请求编码一致(Langfuse 曾因对 protobuf 请求回 JSON 被客户端报错,langfuse#11550)。
- 先例:Langfuse 自建 OTLP endpoint 只收 HTTP 的 JSON + protobuf(明确 "gRPC not supported yet"),且**同时映射四套词汇**(gen_ai semconv / OpenInference / OpenLLMetry / MLflow)——证明「进程内 HTTP 收 OTLP + 接收侧按方言归一」是被大规模验证过的做法。niceeval 的 `src/o11y/otlp/receiver.ts` 已经是同款形状(JSON + protobuf、gzip、按 content-type 回应)。
- 来源:https://opentelemetry.io/docs/specs/otlp/ 、https://langfuse.com/integrations/native/opentelemetry

## 对 niceeval 的印证与启发

1. **mixin 的数据可得性成立,但按生态分层。** 被测应用用的是 AI SDK telemetry / OpenLLMetry / OpenInference 之一(TS/Python AI 应用的大多数)→ 工具入出参和消息文本**默认就在 span 里**,「从 spans 派生 `StreamEvent[]`」有米下锅;用的是 OTel 官方 instrumentation → 默认只有骨架 + token,mixin 要提示用户开 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 才能解锁内容断言。
2. **方言表是接收侧的固定成本,Langfuse 已趟过路。** 四套词汇(gen_ai 新版 / OpenLLMetry 旧式索引 / OpenInference / `ai.*`)各自的工具调用字段都不同,但每套内部结构清楚、有显式 call id——一方言一个薄解析器,与 niceeval 既有的「每 agent 一个薄 mapper」是同一个形状。
3. **接收器不用动。** 现有 receiver 已满足 OTLP/HTTP 双编码 + gzip + 正确响应契约;它现在只服务 trace 瀑布图,见 [Observability](../../../observability.md#otlp-traces-统一瀑布图)。

## 相关阅读

- [agent-loop-apis.md](agent-loop-apis.md) —— 四个 agent loop 的原生 API 面(转换路线的对照组)。
- [otel-genai.md](otel-genai.md) —— 这些生态的 schema 全景与 niceeval 双轨结论。
- [Observability · OTLP traces](../../../observability.md#otlp-traces-统一瀑布图) —— OTel 在当前设计里的实际角色(只画瀑布图,不产出事件)。
