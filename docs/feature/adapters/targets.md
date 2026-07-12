# 接入目标矩阵 —— 12 个被测对象怎么接、代码共享在哪(调研 + 路线图)

> 状态:调研结论 + 接入路线图(2026-07 外部调研,来源见文末),尚未实现的目标都只是提案。通道定义见 [collection.md](collection.md)。事件流的实际接入路线是[官方转换器 / SDK 通道 0 或手写映射](collection.md#接入路线的优先级);OTel 只喂 trace 瀑布图,见 [Observability](../../observability.md#otlp-traces--统一瀑布图)。

回答三个问题:各家 OTel 的 span"标题"统一吗;每个目标好不好接;接的时候哪段代码共享。

## 一、OTel 标题不统一,而且短期不会统一

同一次「LLM 调用 + 工具调用」,六家的 span/事件名各是一样:

| 被测对象 | "标题"长什么样 | kind 字段 | 内容(prompt/工具入出参)默认 |
|---|---|---|---|
| OTel GenAI semconv(规范本体) | `chat {model}` / `invoke_agent {agent}` / `execute_tool {tool}` | `gen_ai.operation.name` | **opt-in**(`gen_ai.input/output.messages` 属性) |
| AI SDK 新模式(`@ai-sdk/otel`,官方推荐) | 遵循 semconv:`invoke_agent {modelId}` → `chat {modelId}` → `execute_tool {tool}` | `gen_ai.operation.name` | **默认全采**(`recordInputs/Outputs` 可关) |
| AI SDK legacy(`experimental_telemetry`) | `ai.generateText(.doGenerate)` / `ai.toolCall` | `operation.name`(`ai.*` 私有) | 默认全采 |
| LangGraph(LangSmith OTel 路线) | span 名 = run name(`ChatOpenAI`、节点名),非 semconv 格式 | `langsmith.span.kind` + 部分 `gen_ai.*` 混合 | 默认全采 |
| OpenAI Agents SDK(官方 contrib 转换后) | 严格 semconv;handoff 是**规范外自造**:`agent_handoff {agent}`(`gen_ai.operation.name="agent_handoff"`) | `gen_ai.operation.name` | 默认采(env 可关) |
| Claude Code(traces beta) | `claude_code.interaction` → `claude_code.llm_request` / `claude_code.tool` | 私有 `claude_code.*` 掺部分 `gen_ai.*` 属性 | **默认 `<REDACTED>`**(三个 `OTEL_LOG_*` 开关) |
| codex CLI | 文档只承认 `codex.*` log events;实测 OTLP 里另有内部 tracing spans(`codex.exec` / `run_sampling_request`…),`mappers/codex.ts` 就是对着它写的 | 私有 | `log_user_prompt` 默认 false |

背景事实:GenAI semconv 已迁到独立仓库 `semantic-conventions-genai`,整套仍标 **Development**,规范明文允许各家自定义 span 名格式;`gen_ai.operation.name` 的取值集合里**没有 handoff**(contrib 自造,与 [multi-agent 提案](../../roadmap/multi-agent/README.md)的 `handoff` 事件互为印证)。内容记录方式已从 events 改为 span 属性(`gen_ai.input/output.messages`),旧的 `gen_ai.prompt/completion` 已弃用但第三方仍在用。

两个结论,都印证既有设计、并给它添料:

1. **收敛点只能放 mapper 层**([observability.md](../../observability.md) 的"canonical = GenAI semconv,每家一个薄 mapper,view 只认 canonical"是唯一现实做法)。新料:AI SDK 官方新模式和 OpenClaw(见下)原生就说 semconv——这两家的 mapper 近乎透传;canonical 层要给 `agent_handoff` 这类规范外 operation 留通道。
2. **OTel 现在只能当时间轨,不管框架埋点采不采内容都一样。** 曾经设想过用"内容默认矩阵"判断 OTel 能不能当行为轨(框架系埋点默认全采 → 直接派生事件),这条路线已经从实现里移除——不管是框架系埋点(AI SDK / LangSmith / OpenInference / OpenLLMetry)还是 CLI 系(claude-code / codex)默认脱敏,行为轨(事件流)一律走 transcript / 官方转换器 / 手写映射,OTel 只画瀑布图。

## 二、矩阵 · Agent Software(沙箱型 CLI,`defineSandboxAgent` 路线)

| | claude-code | codex | bub | **OpenClaw** | **Hermes Agent** | **Alma** |
|---|---|---|---|---|---|---|
| 状态 | ✅ 已接 | ✅ 已接 | ✅ 已接 | 提案 | 提案(低优先) | ❌ 不接 |
| 驱动面 | `claude --print` | `codex exec --json` | `bub run --session-id` | `openclaw agent --message --json`(`--local` 免 gateway) | `hermes chat -q`(无 `--json` 契约) | 无:闭源桌面 GUI,无 CLI/API |
| 会话续接 | `--resume <id>` | `codex exec resume <id>` | `--session-id` | `--session-id` / `--session-key` | `--resume <id>` / `-c` | — |
| 行为轨通道 | 磁盘旁读 JSONL | stdout 捕获 | 磁盘旁读 tape | 磁盘旁读 JSONL:`~/.openclaw/agents/<id>/sessions/<sid>.jsonl`(role/content 块/toolCall/usage.cost) | 磁盘旁读 **SQLite**:`~/.hermes/state.db`(messages 表含 tool_calls,FTS5) | — |
| 时间轨(OTel) | 私有 schema,默认脱敏 → transcript 合成 span | 实测 spans,`mappers/codex.ts` | OTLP/protobuf,`mappers/bub.ts` | **原生 OTLP + GenAI semconv**(`diagnostics-otel` 插件,`captureContent.*` 可开内容) | 第三方插件(gen_ai + OpenInference 双语义) | — |
| 安装(沙箱) | npm | npm | uv | npm(`onboard --non-interactive`) | curl 脚本,依赖重(Python+Node+ffmpeg),无官方 Docker 路径 | 仅 .dmg/.exe |
| 难度 | — | — | — | **低:五个接入面全绿** | 中:采集要 SQLite 读取件,镜像要预制 | 不可接 |

- **OpenClaw 是"下一个该接的"**:驱动面形状与 claude-code 同构(headless 单发 + session id + JSONL 旁读),`defineSandboxAgent` + `shared.captureLatestJsonl` 骨架直接复用,只写一个 parser;时间轨 mapper 近乎透传(原生 semconv)。它是三类目标里唯一"原生说标准话"的。
- **Hermes 的增量成本在两处**:采集层缺一个 SQLite 读取件(通道 1 的变体——旁读的不是 JSONL 是 db 文件;读出行后转换层纪律不变),沙箱镜像要预制(依赖重,同 e2b 模板的经验)。OTel 靠第三方插件,时间轨列为可选。
- **Alma 展示决策树第一问的价值**:没有程序化驱动面就没有 adapter 可写,直接出局,不要为它发明逆向路线。

## 三、矩阵 · Agent Frameworks(进程内 / 服务型,`defineAgent` 路线)

| | AI SDK | **Claude SDK** | **Codex SDK** | **LangGraph** | **Cursor Agent SDK** | **vm0** |
|---|---|---|---|---|---|---|
| 状态 | ✅ 已接(`fromAiSdk` / `uiMessageStreamAgent`) | 提案 | 提案 | 提案 | 提案(观察 beta) | ❌ 暂不接 |
| 调用面 | `generateText` | `query()` → AsyncGenerator\<SDKMessage> | `startThread()` → `thread.run()`(SDK 内部 spawn CLI) | `graph.invoke()` 或未接管理层的服务 | `Agent.create()` → `run.stream()`(local/cloud/self-hosted 三 runtime) | 平台非库:CLI/REST + Ably,无 npm SDK |
| 事件流 | steps 带 `toolCallId` | content 块 + `parent_tool_use_id`(subagent 归属) | ThreadItem(item 内嵌输入输出,免配对) | messages 通道显式配对;或 spans | `SDKMessage`:`tool_call` 带 call_id/args/result,**`request` 事件 = 现成 HITL** | 事件 schema 未公开 |
| 会话 | 工厂自管 | `resume` / `forkSession` | `resumeThread(threadId)` | thread_id(checkpointer) | `Agent.resume(agentId)` | resume API 未公开 |
| HITL | v7 tool approval ✅ | `canUseTool` 回调 | 缺口:审批在 app-server 协议层,SDK 无回调,eval 场景只能 `never` | `interrupt()`(v0.2+) | `request` 事件 + hooks | 未公开 |
| 遥测 | legacy `ai.*` / 新 `@ai-sdk/otel` semconv | 同 claude-code CLI(beta,SDK 路径 span 树有已知残缺) | 同 codex CLI | LangSmith OTel 三 env(混合 schema)或三方埋点 | **无 OTel**(官方建议拿 requestId 自己关联) | 内部 Axiom,无用户导出面 |
| 难度 | — | 中 | **低** | 中(要写精品转换器或手写映射,不再有 mixin 捷径) | 中(beta 风险) | 高且不稳定 |

- **Codex SDK 是复用率最高的一个**:ThreadItem 与 `codex exec --json` 的 item 词汇同源(与 app-server 共享),`o11y/parsers/codex.ts` 的映射逻辑大半直接复用——把"stdout 捕获 + 抠 JSONL"升级成"通道 0 SDK 直构",采集层整段消失。设计判断:作为**现有 codex adapter 的第二形态**(进程内、不需要沙箱时用),不是替代。
- **Claude SDK 同理**:SDKMessage 的 content 块结构 ≈ transcript 行形状,`parsers/claude-code.ts` 的块翻译逻辑可抽出共享核心;SDK 还有官方 `getSessionMessages()`,连磁盘旁读都省了。`parent_tool_use_id` 直接喂 [multi-agent 提案](../../roadmap/multi-agent/README.md)的归属字段。
- **LangGraph 要写精品转换器或手写映射**:事件流需要消费 LangGraph 自己的 messages 结构(手写映射,或将来补一个精品转换器),OTel(`LANGSMITH_OTEL_ENABLED` 三个 env)只用来画瀑布图;HITL/会话按契约补 `send`。
- **Cursor Agent SDK 值得盯**:事件词汇是六家里最贴 niceeval 契约的(`tool_call` 生命周期事件、`request` ≈ `input.requested`、usage 字段最全),`fromCursorSdk` 会比 `fromAiSdk` 还薄;但 public beta 声明 API 会变、无 OTel、三套 runtime——等 GA 再动。
- **vm0 记为观察项**:事件 schema / resume / usage 全未公开,定位还在从 runtime 向托管 teammate 漂移;等接入面稳定,不要对着移动目标写 adapter。

## 四、代码共享在哪:三层各自的共享件

接入成本 = 驱动 × 采集 × 转换 三层之和;每层能共享的件和为新目标要新写的件:

```text
驱动层  defineAgent / defineSandboxAgent / uiMessageStreamAgent(已有)
        新增:无。OpenClaw/Hermes 走 defineSandboxAgent;四个 SDK 走 defineAgent
采集层  shared 工具袋:ensureInstalled / captureLatestJsonl / extractJsonlFromStdout /
        firstJsonField / sessionIdFrom*(已有)
        新增:SQLite 读取件(仅 Hermes 要);SDK 直构目标(Codex/Claude/Cursor SDK)采集层为零
转换层  ① CLI parser(o11y/parsers/*):每 CLI 一个纯函数
           复用对:codex CLI ↔ Codex SDK(同一 item 词汇)、claude-code ↔ Claude SDK(同块结构)
           ——共享的是映射核心,不是文件本身;新写:OpenClaw、Hermes 各一个
        ② 精品转换器(fromAiSdk 已有):高频 + 进程内 + 有 HITL 的框架才配
           候选:fromCursorSdk(等 GA)
        ③ 长尾框架仍需手写映射或精品转换器,没有免写事件映射的捷径
           方言:gen_ai semconv(OpenClaw / AI SDK 新模式 / Agents SDK contrib 共用一个)、
           ai.* legacy、OpenInference、OpenLLMetry、LangSmith 混合
时间轨  OTLP receiver + canonical mapper(已有)
        新写 mapper:OpenClaw 近乎透传;LangSmith 混合方言一个;其余复用或跳过
```

[collection.md 决策树](collection.md#接新被测对象的决策树)相应多一问,插在"应用 HTTP 接口天生带完整调用记录吗 → 否"之后:**官方有没有 SDK 包装?有 → 当通道 0 接(SDK 直构),比逆向它的 stdout/磁盘干净**——Codex SDK 与 Cursor SDK 证明"未接管理层的 CLI"正在变成"有官方 SDK 包装的对象",这条通道会越来越常见。

## 五、优先级建议

1. **OpenClaw**——五面全绿,`defineSandboxAgent` 第四个内置,新代码只有一个 parser + 一个近透传 mapper。
2. **Codex SDK**——现有 codex adapter 的进程内第二形态,parser 复用大半,验证"SDK 通道 0"这条新决策树分支。
3. **LangGraph**——写手写映射或精品转换器消费 LangGraph 的 messages 结构。
4. **Claude SDK**——受益于 multi-agent 提案(`parent_tool_use_id` 归属),两个提案互相解锁。
5. **Cursor Agent SDK**——等 GA;**Hermes**——等有真实需求再付镜像成本。
6. 不接:**Alma**(无驱动面)、**vm0**(接入面未稳定)。记下判据,免得反复重查。

## 来源

- 三路外部调研(2026-07):OpenClaw(docs.openclaw.ai:cli/agent、gateway/opentelemetry、concepts/session)、Hermes Agent(hermes-agent.nousresearch.com docs、briancaffey/hermes-otel)、Alma(alma.now、yetone/alma-releases)、Codex SDK(developers.openai.com/codex/sdk、openai/codex sdk/typescript)、Cursor Agent SDK(cursor.com/docs/sdk/typescript)、vm0(github.com/vm0-ai/vm0)。
- OTel 核实:semantic-conventions-genai 仓库(gen-ai-spans / agent-spans / events / registry)、ai-sdk.dev telemetry 文档、docs.langchain.com trace-with-opentelemetry、openai-agents contrib `span_processor.py` 源码、code.claude.com monitoring-usage、developers.openai.com codex config-advanced。
- 站内既有:[agent-loop-apis.md](reference/agent-loop-apis.md)(Claude SDK / LangGraph 细节)、[otel-instrumentation.md](reference/otel-instrumentation.md)(埋点内容矩阵)、[collection.md](collection.md)(通道)。
