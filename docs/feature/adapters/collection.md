# 采集设计 —— 通道、矩阵与每个被测对象怎么接

这一篇集中回答:**每个被测对象,行为数据和 trace 从哪条路径采、哪些字段从哪里来。**

分工:[Adapter 契约](contract.md) 定义采集的**目标**(`StreamEvent` / `Turn` 长什么样、每条断言要什么数据);[Adapter 写法 · 采集层](authoring.md#采集层原始数据怎么从-agent-cli-弄到手) 讲通用**纪律**(采集脏 / 转换净、raw string 边界、行级容错);本篇是**具体矩阵**——三条外部路线的对比结论、niceeval 的通道设计、以及 claude-code / codex / bub / AI SDK 各自的字段来源(与 `src/o11y/parsers/` 和 `src/agents/` 现状对齐)。接一个新被测对象时,从[决策树](#接新被测对象的决策树)进。

## 三条外部路线:采集路径与字段的取舍

[reference/](README.md#这组文档怎么分) 三篇调研收拢成一张表,核心结论:**采集路径决定字段上限**——你从哪拿数据,决定了你最多能知道什么。

| 路线 | 采集路径 | 字段上限 | 前提 | 代价 |
|---|---|---|---|---|
| [eve](reference/eve-protocol.md) | **无采集**——运行时原生吐协议(NDJSON over HTTP,带版本号) | 最高:26 种事件、`sequence/turnId/stepIndex` 坐标、per-step usage、`RuntimeIdentity` 自报模型 | **拥有运行时** | 只能评自己 |
| [agent-eval](reference/agent-eval.md) | 磁盘旁读(claude-code)+ stdout 捕获(codex),另开第二通道读磁盘抠实际模型;无 trace | 最小公分母:5 种事件、无 callId(顺序配对)、丢 turn/step 边界 | 无(逆向未接管理层的对象) | 每个 CLI 一堆 hack,并发配对会错 |
| [OTel GenAI](reference/otel-genai.md) | OTLP 网络推送(agent 自己 instrument) | span 树带时间与层级;但消息内容 / 工具入参 **opt-in**,常缺 | agent 愿意发、发得对 | 断言最需要的内容字段恰恰不保证有 |

## niceeval 的设计:双轨 × 四通道

行为和时间分两轨,各自选通道;一个 agent 可以多通道并用,按"这份数据用来干什么"分别决定怎么采(agent-eval 的 codex 双通道教训):

```text
行为轨(StreamEvent[] —— 断言的唯一数据源,必须全量)
  通道 0 · 官方转换器直构   remote agent:send 消费天生带完整调用记录的返回(官方转换器直接映射成事件),零手写映射
  通道 1 · 磁盘旁读     CLI 为自己 resume 写的侧写文件(claude-code transcript、bub tape)
  通道 2 · stdout 捕获  CLI 的结构化输出 flag(codex --json)
       ↘ 通道 1/2 统一收窄成 raw string → o11y/parsers/<agent>.ts(纯函数,可单测)

时间轨(TraceSpan[] —— 瀑布图,允许缺)
  通道 3 · OTLP 推送    agent 经 OpenTelemetry 推给运行器的本机接收器
                        → o11y/otlp/mappers/<agent>.ts 归一 canonical GenAI semconv
                        没有 OTel 输出的(claude-code)从 transcript 时间戳合成 span
```

两轨的容错要求不同,这是设计的关键不对称:**行为轨缺数据是契约问题**(负断言静默假通过,见[契约 · 负断言完整性规则](contract.md#负断言的完整性规则)),做不到完整就如实说明这条 eval 的负断言不可信;**时间轨缺数据是降级**(view 少画一张瀑布图,断言不受影响)。

## 采集矩阵:现状(与 `src/` 对齐)

每行都是"这个字段从原始数据的哪里抠"——写新 parser 时照这个粒度补一行:

| | claude-code | codex | bub |
|---|---|---|---|
| **行为轨通道** | 磁盘旁读 | stdout 捕获 | 磁盘旁读(tape) |
| **原始位置** | `~/.claude/projects/<slug>/` 最新 `.jsonl`(`shared.captureLatestJsonl`) | `codex exec --json` 的 stdout(`shared.extractJsonlFromStdout`) | `~/.bub/tapes/<md5(ws)__md5(sess)>.jsonl` |
| **行形状** | `{ type: "user"\|"assistant", message: { content: [...], usage } }`,content 混 text / tool_use / thinking 块 | 生命周期事件(`thread.*` / `turn.*` / `item.*` / `response.*`) | `{ kind: message\|tool_call\|event\|anchor, payload }` |
| **callId 配对** | `tool_use.id` ↔ user 行里 `tool_result.tool_use_id`(显式,坑:工具结果包装成 user 消息) | `call_id` 显式 + FIFO 队列兜底(老式 `function_call_output` 无 id) | 与上一条 tool_call **按位对齐** + 合成 id 兜底 |
| **usage** | assistant 行 `message.usage`(含 cache read) | 防御式多路径:`data/payload/item/turn/response.usage`,兼容 `input/output_tokens` 与 `prompt/completion_tokens` 两套命名 | `event(name=="run")` 的 `data.usage`(`prompt/completion_tokens`,**`cost` 直接有**) |
| **session id(resume 用)** | transcript 首个 `sessionId` 字段(`shared.sessionIdFromClaudeTranscript`) | `thread.started.thread_id`(`shared.codexThreadId`) | tape 文件名含 session hash;adapter 自管 |
| **实际模型** | transcript 行内有 | 网关场景要第二通道读 `~/.codex/sessions` 的 `turn_context.payload.model`(agent-eval 的做法;niceeval 未接,记为已知缺口) | tape 内 run 事件 |
| **时间轨** | beta 版原生 OTLP trace 导出,已接进 adapter 的 `tracing.env`(`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` 等一串 env;span 只有结构与计时、内容默认脱敏,内容仍由 transcript 旁读补全,详见 [reference/claude-code-otel-telemetry.md](reference/claude-code-otel-telemetry.md)) | 原生 OTLP/JSON(`config.toml [otel]`,走 `tracing.configure`) | 原生 OTLP/protobuf(env-based `OTEL_*`,走 `tracing.env`) |

remote agent(通道 0)不在表里——它没有"采集",字段来源就是你自己代码里的返回值,见下节示例。

## 接入路线的优先级

用户侧的建议顺序(docs-site 的接入导流已按此排):

1. **内置件**:AI SDK `useChat` 后端应用用 `uiMessageStreamAgent`(走 HTTP,无侵入),coding agent 用内置三个 sandbox agent;
2. **官方转换器 / SDK 通道 0**:`fromAiSdk` 这类精品转换器(消费你的 HTTP 接口返回的、形状像 AI SDK 结果的 JSON),或官方 SDK 包装(Codex SDK / Cursor SDK,见 [targets.md](targets.md));
3. **手写映射**:以上都接不了的应用,`toStreamEvents` 兜底。

**OTel 不在这条优先级列表里,因为它不产出事件。** 所有断言依据必须来自上面这条行为轨的选择。OTel 是完全独立的第二件事:配置好之后(agent 的 `tracing` 块,或 remote agent + `defineConfig({ telemetry })`),`niceeval view` 多一张调用瀑布图,不影响、也不参与上面的选择,详见 [Observability · OTLP traces](../../observability.md#otlp-traces--统一瀑布图)。

## 接新被测对象的决策树

```text
应用的 HTTP 接口返回天生带显式 callId、完整调用记录?(比如内部用 AI SDK / Responses API 实现)
├─ 是 → 通道 0:官方转换器(`fromAiSdk` 等)直接消费接口返回,保真上限最高,见下面示例
└─ 否 → 未接管理层的 CLI / 别人的服务
        ├─ 官方有 SDK 包装?(Codex SDK / Cursor SDK,见 targets.md)→ 当通道 0 接,别逆向 stdout/磁盘
        ├─ CLI 有结构化输出 flag(--json)?      → 通道 2:stdout 捕获
        ├─ 没有,但 CLI 为 resume 写侧写文件?    → 通道 1:磁盘旁读(找它的 session 目录)
        └─ 都没有                               → 老实做第一步:events 传 [],
                                                  别让负断言假通过——如实说明这条 eval 的负断言不可信
trace 另算,和上面的选择正交:CLI/应用会发 OTel?→ 写 tracing 块(或 remote agent 配 defineConfig({ telemetry }))+ mapper;
                                                不会 → transcript 时间戳合成,或直接跳过(只影响瀑布图,不影响断言)
```

字段找不到时的取舍,有先例可循:

- **callId 缺失** → 按位 / FIFO 兜底(bub、codex 老格式的做法)——能用,但这是在赌"工具调用严格顺序",并发即错配;有显式 id 一定用显式 id。
- **usage 缺失** → 不填,**别编数字**。后果是 `maxTokens` / `maxCost` 假通过(见契约),这比错误的成本数据可接受。
- **实际模型拿不准**(网关改写)→ 学 agent-eval 开第二通道去磁盘 session 文件里读,别信请求参数。

### 通道 0 示例:官方转换器直构(应用返回天生带完整调用记录)

AI SDK 的 `generateText` 返回天生带显式 `toolCallId`、分 step、带 usage——映射几乎是逐字段抄写,这是通道 0 的典型代表。这层映射(含 v4/v5/v7 字段名漂移:`args`/`input`、`result`/`output`、`promptTokens`/`inputTokens`/`inputTokenDetails`)已收进 `fromAiSdk`(`niceeval/adapter` 导出,`src/agents/ai-sdk.ts`,结构化 typing、不依赖 `ai` 包)。

用法是:你自己的 HTTP 服务内部用 AI SDK 实现,接口返回的 JSON 形状就是 AI SDK 的结果(或贴近它)——adapter 的 `send` 照常 `fetch` 你的接口,拿到响应后用 `fromAiSdk` 转成标准事件流,不需要手写映射:

```typescript
// agents/my-ai-sdk-app.ts —— send 走 HTTP,响应体形状贴近 AI SDK 结果
import { defineAgent, fromAiSdk } from "niceeval/adapter";

export default defineAgent({
  name: "my-ai-sdk-app",
  async send(input, ctx) {
    const r = await fetch(`${process.env.MY_APP_URL}/api/chat`, {
      method: "POST", body: JSON.stringify({ message: input.text }), signal: ctx.signal,
    });
    const result = await r.json();   // 形状贴近 AI SDK 的 GenerateTextResult
    // steps 里带 toolCallId 的完整调用记录 + 全 step 聚合 usage + waiting/completed → 一行转完
    return { ...fromAiSdk(result), data: result.text };
  },
});
```

`fromAiSdk` 做的事,对照矩阵读:`toolCallId` 直接就是 `callId`(不需要兜底);v5+ 的 `step.content` parts 自带真实顺序(reasoning → tool-call → tool-result → text),时序保真;`tool-error` part 映射成 `status: "failed"` 的 `action.result`,喂 `noFailedActions()`;v7 tool approval(`needsApproval` 工具)的 `tool-approval-request` part 映射成 `input.requested` 事件 + 整轮 `status: "waiting"`,resume 后被拦工具的执行结果从 `responseMessages` 里补成 `action.result`(拒绝 = `rejected`,不是 `failed`)——HITL 契约的「waiting + input.requested」两条义务由转换器直接满足;usage 用 `totalUsage`(全 step 聚合)优先、v7 的 cache tokens 从 `inputTokenDetails` 读(eve 按 step 记的粒度这里是可得而未取,见 [eve 笔记 · 启发 3](reference/eve-protocol.md#对-niceeval-适配器设计的启发));时间轨可选接 AI SDK 的 `experimental_telemetry`(OTel spans → mapper)。

应用用的是 AI SDK `useChat` 后端(UI Message Stream 协议)而不是自定义 JSON 接口时,优先用内置的 `uiMessageStreamAgent`(`niceeval/adapter` 导出,`src/agents/ui-message-stream.ts`)——它把 SSE 归约、全量历史重放、HITL 审批改写重发都托管了,adapter 只剩配置,完整可跑参考见 `examples/zh/tier1/ai-sdk-v7/`。

自有 HTTP 服务同理走通道 0:协议是服务的私事,但如果服务是你写的,**让它直接返回 `StreamEvent` 兼容的 JSON 是最省的适配**——`toStreamEvents` 退化成透传,完整可跑参考见 `examples/zh/tier1/ai-sdk/`。

## 接新未接管理层 CLI 的清单

以"接 gemini-cli / opencode / 下一个"为例,照矩阵补一列的活:

1. **选行为轨通道**:翻它的文档 / strace 找结构化输出 flag(通道 2);没有就找 `~/.<cli>/` 下的 session 侧写(通道 1)。
2. **写 parser**(`o11y/parsers/<name>.ts`):纯函数只吃 `raw: string`;逐行 try/catch;按[契约 · 事件流三条纪律](contract.md#标准事件流)产事件(时序、callId、双名字);usage 学 codex 的防御式多路径。
3. **抠 session id**:resume 要用;学 `shared.firstJsonField` 的通用兜底。
4. **时间轨**:CLI 有 OTel 配置就写 `tracing` 块 + mapper;没有先跳过(降级不崩)。
5. **对照矩阵自查字段**:callId 显式吗?usage 哪套命名?实际模型在哪?——每格都该能回答"从哪抠",答不上的格子显式记为缺口(像上表 codex 实际模型那格)。

## 相关阅读

- [Adapter 契约](contract.md) —— 采集的目标形状与逐断言数据义务。
- [Adapter 写法](authoring.md) —— 采集纪律、分档、shared 工具袋。
- [reference/](reference/agent-eval.md) —— 三条路线的原始调研(agent-eval / OTel GenAI / eve)。
- [Observability](../../observability.md) —— parser 与 mapper 在 o11y 管线里的位置。
