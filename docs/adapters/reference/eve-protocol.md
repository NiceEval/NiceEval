# eve 的协议机制:自产自销的运行时事件流(源码阅读记录)

**来源:** 直接读 `/Users/ctrdh/Code/eve`(本机 checkout)的源码。关键文件:

- 协议定义:`packages/eve/src/protocol/message.ts`(`HandleMessageStreamEvent` 联合,530 行)
- action / input 字段:`packages/eve/src/runtime/actions/types.ts`、`runtime/input/types.ts`
- eval 侧消费:`packages/eve/src/evals/session.ts`、`evals/runner/derive-run-facts.ts`

和另两篇参考对照着读,三条路线正好补齐:[agent-eval](agent-eval.md) 是**逆向适配别人的协议**(读未接管理层的 CLI 的 transcript,转换成自定义闭集),[OTel GenAI](otel-genai.md) 是**标准化遥测**(span 树,行业公约),eve 是第三条——**协议不是转换出来的,是运行时原生吐的**。eve 同时拥有 agent 运行时(Vercel AI SDK `streamText` 外包一层 harness)和 eval 框架,两者共享同一套 wire 协议,**没有采集层、没有转换层**:

```text
模型 API → AI SDK streamText → eve harness(唯一规范化层)
  → HandleMessageStreamEvent(NDJSON over HTTP)
    → eval client 逐行 parse → t.events 直接就是它,零二次转换
```

niceeval 的位置一句话:**契约形状学 eve(强类型事件、callId、`rejected`、parked),采集方式像 agent-eval(读未接管理层的 CLI transcript),trace 归一到 OTel**。本篇记录 eve 这套协议到底怎么收集、收集了什么字段——为 niceeval 的 `StreamEvent` 演进提供上限参照。

## 采集机制:没有"采集",只有"传输"

因为运行时是自己的,"怎么拿到数据"退化成传输问题,但传输层有几个值得记的机制设计:

- **显式协议版本。** `EVE_MESSAGE_STREAM_VERSION = "16"`,连同 `x-eve-session-id` / `x-eve-stream-format` 作为 HTTP 头随流下发(content-type `application/x-ndjson`)。协议演进有版本号,消费端能识别拒绝——对比 agent-eval 面对 CLI 格式漂移只能写 `data.type || data.event || data.kind` 这种轮试兜底。
- **HITL 续接是一等公民。** 请求体是联合类型:首轮 `{ message }`;续轮 `{ continuationToken, message }` **或** `{ continuationToken, inputResponses }`。resume 靠 token 而不是 CLI flag;回答 HITL 是结构化的 `InputResponse[]`——`{ requestId, optionId?, text? }`,**带 requestId 定位到具体哪个请求**,不是"再发一条用户消息"。
- **事件持久化 + 可回放。** 每个事件可带 `meta: { at }` 时间戳,运行时在写入 workflow-owned stream 前盖章,"so replay preserves the original timing"——事件流同时是持久会话记录,回放不失真。

## 事件词汇:26 种类型,带三级坐标

`HandleMessageStreamEvent` 是 26 个成员的判别联合。和 niceeval `StreamEvent`(9 种)最大的结构差异:**几乎每个事件带 `sequence`(全序)+ `turnId` + `stepIndex` 坐标**——事件不止有顺序,还有归属;而 niceeval 的事件只有数组顺序,turn 归属靠"哪次 `send` 返回的"隐式表达。

按层列出(字段为源码原文):

| 层 | 事件 | 关键字段 |
|---|---|---|
| **session** | `session.started` | `runtime?: RuntimeIdentity`(见下)、`invocation?`(subagent 元数据:parentCallId / parentSessionId / parentTurnId) |
| | `session.waiting` | `{ wait: "next-user-message" }`——干净停在等输入 |
| | `session.completed` / `session.failed` | failed 带 `{ code, message, details? }` |
| **turn**(一次用户输入到稳定) | `turn.started` / `turn.completed` / `turn.failed` | `turnId` + `sequence`;failed 带结构化 `code / message` |
| **step**(turn 内的一次模型调用) | `step.started` / `step.completed` / `step.failed` | completed 带 `finishReason` + **`usage { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`**——用量按 step 记,不是按 turn 聚合 |
| **内容** | `message.received` | 用户消息回显(niceeval 由 runner 侧补 user message 事件,同一目的) |
| | `message.appended` / `message.completed` | appended 带 `messageDelta / messageSoFar`(流式);completed 带 `message` + `finishReason` |
| | `reasoning.appended` / `reasoning.completed` | 思考块,同样 delta + 完整两段式 |
| | `result.completed` | `{ result: JsonValue }`——结构化输出(对应 niceeval 的 `Turn.data`,但 eve 是事件) |
| **动作** | `actions.requested` | `{ actions: RuntimeActionRequest[] }`(见下);文档明确"consumers must correlate action lifecycles by call ID" |
| | `action.result` | `{ result, status: "completed" \| "failed" \| "rejected", error?: { code, message } }`——**结构化错误**,"keeps UI consumers from having to parse provider- or tool-specific output strings" |
| | `input.requested` | `{ requests: InputRequest[] }`(见下) |
| | `authorization.required` / `authorization.completed` | OAuth / 连接授权,**独立于 HITL 问答**;completed 带 `verdict: "authorized" \| "declined" \| "failed" \| "timed-out"` |
| **subagent** | `subagent.called` | `{ callId, childSessionId, sessionId, name, toolName, workflowId, remote?: { url } }` |
| | `subagent.started` / `subagent.completed` | completed 带 `{ callId, output }` |
| | `subagent.event` | `{ callId, subagentName, event: HandleMessageStreamEvent }`——**子 agent 的事件递归嵌套转发**,保留归属 |
| **压缩** | `compaction.requested` / `compaction.completed` | requested 带 `usageInputTokens`(触发时的上下文水位) |

### `RuntimeActionRequest`:action 是 kind 判别联合

```typescript
type RuntimeActionRequest =
  | { kind: "tool-call";         callId: string; toolName: string; input: JsonObject }
  | { kind: "load-skill";        callId: string; input: JsonObject }
  | { kind: "subagent-call";     callId: string; name: string; subagentName: string; nodeId: string; description: string; input: JsonObject }
  | { kind: "remote-agent-call"; callId: string; name: string; remoteAgentName: string; nodeId: string; description: string; input: JsonObject };
```

`load-skill` 在 eve 里真的是一种 action kind——这就是 niceeval `t.loadedSkill` = `calledTool("load_skill")` 语法糖的出处;subagent 调用也是 action 的一种,再由运行时展开成 `subagent.*` 事件。

### `InputRequest`:HITL 请求的完整形状

```typescript
interface InputRequest {
  requestId: string;                                  // 稳定 id,回答时用它定位
  prompt: string;
  action: RuntimeToolCallActionRequest;               // 停在哪个工具调用上——完整对象,不是字符串
  display?: "confirmation" | "select" | "text";       // 渲染提示;审批 = confirmation + approve/deny 两个 option
  options?: { id: string; label: string; description?: string; style?: "primary" | "danger" | "default" }[];
  allowFreeform?: boolean;                            // 是否允许自由文本代替选项
}
```

niceeval 的 `InputRequest` 与它几乎同构但全字段 optional(要兼容信息量少的 agent);eve 的 `action` 是完整工具调用对象而非 `action?: string`,`allowFreeform` / `style` 是 niceeval 没有的。

### `RuntimeIdentity`:被测对象自报身份

```typescript
interface RuntimeIdentity {
  agentId: string; agentName?: string;
  eveVersion: string;
  build?: { deployedAt?, gitBranch?, gitSha? };
  modelId: string;      // ← 实际在用的模型,协议里直接给
}
```

对照 agent-eval 的痛点:codex 经网关后"实际用的模型"要从磁盘 session 文件里抠 `turn_context.payload.model`([笔记](agent-eval.md#采集层两份-parser-之前原始数据从哪来));eve 因为拥有运行时,直接在 `session.started` 里自报。

## eval 侧怎么消费

- **`t.events` 就是原始协议事件**,没有第二层 eval 专用 schema。作用域断言直接查这条流。
- **派生事实**(`derive-run-facts.ts` → `EveEvalDerivedFacts`):`toolCalls / toolCallCount / subagentCalls / subagentCallCount / inputRequests / parked / messageCount / reasoningBlockCount / failureCode?`。比 niceeval 的 `DerivedFacts` 多 `reasoningBlockCount` 和 `failureCode`(顶层失败码,从 `*.failed` 事件抠)。
- **轮次边界在协议里**:`isCurrentTurnBoundaryEvent` = `session.completed | session.failed | session.waiting`——客户端读到边界事件就知道这轮到头了,不靠连接关闭或超时猜。
- **parked 判定同思路**:`endedParkedOnInput(events)`,niceeval 的"最后一条有意义事件是 `input.requested`"与之对齐。

## 对 niceeval 适配器设计的启发

**先泼冷水:eve 是上限,不是榜样。** 它不需要采集 / 转换,是因为它拥有运行时;niceeval 面对未接管理层的 coding agent CLI 永远做不到。但有一个例外方向:**remote agent(用户自己的 agent)里,用户就是运行时的主人**——`toStreamEvents` 理论上可以做到 eve 级保真。分档表的 T1 对 remote agent 的天花板,比 sandbox agent 高得多。

具体字段层面,值得记进 `StreamEvent` 的演进候选(都不是现在就加,是"需要时有先例"):

1. **坐标系(`sequence` / `turnId` / `stepIndex`)。** niceeval 单轮内的 step 边界(一次 CLI 运行内多次模型调用)目前丢失;claude-code transcript 里其实带这个信息。要支持"第几步做了什么"级别的断言或 view 分组时,eve 的三级坐标是现成方案。
2. **`action.result.error: { code, message }`。** niceeval 只有 `status`,失败原因埋在 `output` 字符串里;"消费方不该解析工具私有输出来判断失败"这个理由对 view 和断言同样成立。
3. **usage 按 step 记。** niceeval 的 `usage` 挂在 `Turn`(整轮聚合);eve 挂在 `step.completed`(每次模型调用一份)。transcript 里常有 per-step 用量,聚合前丢掉了瀑布图想要的粒度。
4. **agent 自报元数据(`RuntimeIdentity`)。** `Turn` 或 `session.started` 级的可选 `runtime?: { modelId, version, … }`,让"实际用的模型"从抠磁盘变成契约字段——网关场景的成本核算靠它才准。
5. **带 `requestId` 的逐请求回答。** eve 的回答是 `{ requestId, optionId?, text? }`;niceeval 的 `respond(...responses)` 把回答 join 成一段普通 send 文本,多个待答请求并发时表达不了"哪个回答给哪个请求"(`respondAll` 只能全选同一 option)。将来要支持,对比一眼可见:

   ```typescript
   await t.respond("yes");                                  // 现状:回答作为下一轮文本,靠 agent 自己对上
   await t.respond({ requestId: req.requestId, optionId: "approve" });  // eve 形状:显式定位
   ```

6. **`authorization.*` 与 `input.requested` 分开。** 授权(OAuth / 连接)和 HITL 问答是两种"停",eve 分成两组事件、各带 verdict;niceeval 目前只有一种。评测带三方连接的 agent 时会需要。
7. **落盘工件带 schema 版本。** `StreamEvent` 是进程内模型可以不带版本,但 `.niceeval/<run>/` 的事件流 JSON 文件是跨版本读的;eve 的 `x-eve-stream-version` 头是先例。niceeval 的具体取舍见 [Results Format · 版本与升级设计](../../results-format.md#版本与升级设计):版本号放在 run 级 `summary.json` manifest 里,attempt 文件继续保持裸 JSON array/object。

没抄的也记一笔:**流式 delta(`message.appended` 的 `messageDelta / messageSoFar`)不需要**——评测离线跑,整段的 `message` 事件就够;AG-UI 的三段式同理(见 [otel-genai 笔记](otel-genai.md#ag-ui--和-niceeval-streamevent-同形态的扁平事件流))。要做"实时看 agent 跑"的 view 时再回头看。

## 相关阅读

- [agent-eval 笔记](agent-eval.md) —— 逆向适配路线:采集 / 转换 / 落地三层与顺序配对的坑。
- [OTel GenAI 等标准](otel-genai.md) —— 标准化遥测路线;三条路线的汇总对照表在那篇。
- [Adapter 契约](../contract.md) —— niceeval 自己的 `StreamEvent` 词汇与逐 API 义务。
- [Observability](../../observability.md) —— 双轨设计:StreamEvent 断言 + canonical GenAI trace。
