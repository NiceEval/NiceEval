# Adapter 契约 —— eval 调什么,adapter 返回什么

这一篇是 adapter 的**规范参考**:接口形状、标准事件流词汇,以及核心内容——**逐 `t` API 的适配义务表**:eval 作者每调一个 `t.*`,运行器把它翻成什么、adapter 必须返回什么、返回错了或缺了会以什么方式暴露。

怎么一步步把 adapter 写出来(分档递进、remote / sandbox 示例、采集层技巧)见 [Adapter 写法](authoring.md);Agent / Adapter 是什么、为什么没有 `--url` 见 [README](README.md)。

## Agent 契约

不管底下是 HTTP、还是沙箱 CLI,所有 agent 对运行器暴露同一个契约:**接过一次输入,驱动被测对象,交回一个以标准事件流为核心的 `Turn`。** 以下与 `src/agents/types.ts` 对齐:

```typescript
interface Agent {
  readonly name: string;                       // "my-bot" / "claude-code" / "codex"
  readonly kind: "sandbox" | "remote";         // 内部判别字段,用户不声明;由 defineSandboxAgent / defineAgent 恒定写死
  setup?(sandbox: Sandbox, ctx: AgentContext): Promise<void | Cleanup> | void | Cleanup;
                                               // 每个沙箱一次:装 CLI / 写主配置;可返回 cleanup
  tracing?: AgentTracing;                      // OTLP 导出配置(沙箱型 CLI 常用;remote agent 只要 config.telemetry 配了端口就够)
  spanMapper?: SpanMapper;                     // 原生 span → canonical 的薄 mapper;省略走通用 heuristic;只影响瀑布图
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;   // 每轮一次
  teardown?(sandbox: Sandbox, ctx: AgentContext): Promise<void> | void;  // 收尾清理(finally 跑)
}

interface TurnInput {
  readonly text: string;
  readonly files?: readonly InputFile[];          // 多模态附件;不支持的 adapter 忽略即可
  readonly responses?: readonly InputResponse[];  // 仅回答轮(t.respond / t.respondAll):逐请求的结构化回答
}

interface Turn {
  readonly events: StreamEvent[];   // 必填。一切作用域断言的唯一数据源;纯 data agent 传 []
  readonly data?: unknown;          // 结构化输出(供 outputEquals / outputMatches),与 events 独立
  readonly status: "completed" | "failed" | "waiting";  // waiting = 停在 HITL 输入上
  readonly usage?: Usage;           // token 用量;maxTokens / maxCost / 成本估算靠它
}

interface AgentContext {
  readonly signal: AbortSignal;
  readonly model?: string;               // experiment 给;省略 → 用 agent 原生默认
  readonly flags: Readonly<Record<string, unknown>>;  // experiment 的 feature flags,透传
  readonly sandbox: Sandbox;             // 仅沙箱型 agent 有意义(运行器按 kind: "sandbox" 备好)
  readonly session: AgentSession;        // 本条会话线的状态槽(存取器组,见下)
  readonly telemetry?: Telemetry;        // 仅配置了 OTel 接入时有:OTLP 端点 + ready-to-spread env/headers
  log(msg: string): void;
}

interface AgentSession {
  readonly id?: string;                      // 会话续接·服务端记历史:本线记过的 id;新会话线是 undefined
  capture(id: string | undefined): void;     // 记回传的 id;只在还没记过时落地(first-writer-wins)
  history<TMsg>(): { get(): TMsg[]; commit(messages: TMsg[]): void };  // 会话续接·客户端带全量历史
  hold<T>(state: T): void;                   // HITL 停轮现场:存
  take<T>(): T | undefined;                  // HITL 停轮现场:取,取到即清除(一次消费)
  readonly state: Record<string, unknown>;   // 逃生舱:自由状态槽,起始 {},框架从不写入
}
```

`send` 是**统一动词**,`Turn.events` 是**统一产物**。区别只在 `send` 内部怎么把原始返回变成 `events`——这就是 adapter 的核心难点。

![一次 t.send 的完整往返：eval 调用 t.send，运行器组装 TurnInput 与 ctx，adapter 调用你的应用并返回标准事件流 Turn。](../../docs-site/images/agent-turn-roundtrip-zh.svg)

`defineSandboxAgent` / `defineAgent`(见 `src/define.ts`)产出的都是这个 `Agent`,差别只在 `kind` 字段和语义:沙箱型的 `send` 在沙箱里 spawn CLI,remote 的 `send` 按你服务的协议发请求。`setup` 装 CLI 这类"每个沙箱一次就够"的动作不要放 `send`——多轮时 `send` 会被调多次,放里面等于每轮重装。

就算 agent runtime 和 eval 在同一个代码库里,也不建议把 `send` 写成进程内直调你的函数——理由和 HTTP 的取舍见[接入你的 Agent · 为什么不直调](../../docs-site/zh/guides/connect-your-agent.mdx)。`Agent.kind` 只有 `"sandbox"` 和 `"remote"` 两种,没有独立的"进程内"分类:进程内调用只是 `defineAgent`(`kind: "remote"`)的 `send` 里发生的事,不是第三种契约。

## 能力从哪来:构造证明,不是问卷

`t` 上解锁什么完全由**构造证据**决定,没有 `capabilities` 这样的声明式字段——`Agent` 接口里不存在它。逐项对照:

| `t` 上解锁什么 | 证据是什么 |
|---|---|
| `t.send`、`t.sendFile`、`t.check`、`t.judge`… | 任何 Agent 都有 |
| 多次 `t.send()`、`t.reply`、`t.newSession()` | `send` 里接了 `ctx.session` 的续接存取器(`history()` 或 `id` + `capture()`)——没接则每轮各是新对话 |
| `t.respond()` / `t.parked()` 等 HITL | send 返回过 `"waiting"` + `input.requested` 事件——做到了就是有 |
| `t.calledTool()` / `t.toolOrder()` 等正断言 | events 里有 `action.*` |
| `t.notCalledTool()` / `t.usedNoTools()` 等负断言**可信** | 事件来自带完整性证明的官方转换器(SDK 原生事件流透传、`fromAiSdk` 的 `result.steps`、Responses 的 `output`);手写映射没有这份证明,负断言可信度按来源判断,不按作者的自觉 |
| `t.sandbox`、`t.sandbox.fileChanged()` 等 | `defineSandboxAgent` 构造(`kind: "sandbox"`) |
| `EvalResult.trace`、`niceeval view` 瀑布图 | 配置了 OTel 接入(agent 的 `tracing` 块,或 remote agent + `defineConfig({ telemetry })`)——只画瀑布图,不影响任何断言,详见[观测性](../observability.md#otlp-traces--统一瀑布图) |

唯一仍然存在的运行时守卫是**沙箱能力**:`t.sandbox` / `t.sandbox.file()` / `t.sandbox.fileChanged()` 等直接读沙箱文件系统,非沙箱型 agent(`kind !== "sandbox"`)调用这些方法会立即得到清晰报错(`src/context/context.ts` 的 `capabilityGuard`)——没有沙箱就没有东西可读,不报错会静默返回空结果。其余能力(多轮对话、工具观测……)不设运行时守卫:没接会话存取器的 agent 每轮各是新对话(不报错,只是断言看不到历史);没吐 `action.*` 事件的 agent 上正断言自然不命中;负断言的可信度靠事件来源判断,不靠拦截调用。

## 标准事件流

你能写的整套作用域断言,全部建立在这条标准的、带类型的事件流上。adapter 唯一的硬活,就是把这个 agent 的原始输出映射成这条流;映射完,所有断言都是 core 算的,与 agent 无关。

```typescript
type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
      // 工具 / 技能调用发起。name = 原始名(如 "Bash"),tool = 归一后的规范名(如 "shell")
  | { type: "action.result"; callId: string; output?: JsonValue;
      status: "completed" | "failed" | "rejected" }        // 与 called 按 callId 配对
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }  // 子 agent 委派
  | { type: "subagent.completed"; callId: string; output?: JsonValue;
      status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }     // HITL:agent 停下等人输入
  | { type: "thinking"; text: string }
  | { type: "compaction"; reason?: string }                // 上下文压缩
  | { type: "error"; message: string };
```

技能加载(`load_skill`)就是一种 `action.called`,所以 `t.loadedSkill` 只是 `t.calledTool("load_skill", …)` 的语法糖,无需单独事件类型。

产出这条流时的三条纪律:

1. **时序即语义。** 事件按真实发生顺序排——`eventOrder` / `toolOrder` 靠子序匹配,解析时不要按类型分桶再拼接(先全部 message 再全部 action 会让顺序断言全错)。
2. **`callId` 配对。** 每个 `action.called` 都应有配对的 `action.result`。这是 niceeval 相对 agent-eval 的明确取舍(它靠"数组里最后一条未配对记录"的顺序假设,并发调用会错配,见[参考笔记](reference/agent-eval.md#两份-parser-对比暴露的设计事实));显式 id 在乱序 / 并发下也不错配。配对的兜底语义(`deriveRunFacts`):只有 called 没有 result → status 按 `"completed"` 算;只有 result 没有 called → 补一条 `name: "unknown"` 的占位调用。
3. **双名字都填。** `name` 放 agent 的原始工具名,`tool` 放归一后的[规范名 `ToolName`](../observability.md#transcript--标准事件流)。派生 `ToolCall` 用 `tool` 当 `name`(缺省落 `"unknown"`)、原始名进 `originalName`;`calledTool` / `toolOrder` 两个名字都认,但跨 agent 断言(`calledTool("file_read")`)只有填了 `tool` 才能命中。

### 派生事实(core 算,共享,agent 无关)

core 的 `deriveRunFacts(events)` 把扁平事件流折叠成结构化事实——这步对所有 agent 一样:

```typescript
interface DerivedFacts {
  readonly toolCalls: readonly ToolCall[];         // action.called + result 按 callId 合并,带最终 status
  readonly subagentCalls: readonly SubagentCall[]; // subagent.called + completed 合并,带 remoteUrl
  readonly inputRequests: readonly InputRequest[];
  readonly parked: boolean;      // 最后一条「有意义」事件是 input.requested(忽略尾随 thinking / compaction)
  readonly messageCount: number;
  readonly compactions: number;
}
```

### `InputRequest`:HITL 请求要填哪些字段

`t.requireInputRequest(filter?)` 的 filter 逐字段匹配 `InputRequest`,所以 adapter 吐 `input.requested` 时,**filter 可能匹配的字段都要尽量填**:

```typescript
interface InputRequest {
  readonly id?: string;          // 请求 id(filter.id)
  readonly prompt?: string;      // agent 问人的问题文本(filter.prompt)
  readonly display?: string;     // 展示给人的摘要(filter.display)
  readonly action?: string;      // 停在哪个工具 / 动作上,如 "deploy"(filter.action)
  readonly input?: JsonValue;    // 该动作的入参(filter.input 逐键匹配)
  readonly options?: readonly { id: string; label?: string }[];  // 可选项(filter.optionIds)
}
```

## 逐 API 适配义务

这是本篇的核心:**eval 侧每个 API ↔ 运行器的翻译 ↔ adapter 的义务 ↔ 违约的暴露方式**。`session.*` 与 `t.*` 的同名 API 义务完全相同,只是绑定的会话线不同。

### 驱动 API(adapter 要「做」什么)

#### `t.send(text)` / `session.send(text)`

- **运行器做什么:** 记一条 `message(role: "user")` 事件 → 调 `agent.send({ text }, ctx)`,`ctx.session` 绑定当前会话线 → 把返回 Turn 的 `events` / `usage` 累进该 session 和 run 级聚合,`input.requested` 事件收进该 session 的 pending 列表(**每次 send 前先清空**)。
- **adapter 返回:** 一个 `Turn`。`events` 按时序、`status` 如实、能拿到就带 `usage`;接了会话续接存取器的 agent 把本轮会话 id 写回 `ctx.session.capture(id)`,或把新消息 `commit` 进 `ctx.session.history()`。
- **违约表现:** `events` 空 → 文本 / 工具断言全部无数据(正断言 fail、负断言假通过);`status` 恒 `"completed"` → `succeeded` 假通过、HITL 判定失效。

#### `t.sendFile(path, text?)` / `session.sendFile`

- **运行器做什么:** 读本地文件转 base64 → `agent.send({ text, files }, ctx)`,其余同 `send`。
- **adapter 义务:** 自行决定投递方式(remote 塞进请求体;沙箱型可写进沙箱再在 prompt 里引用路径)。不支持多模态就**忽略 `files`、照常跑 `text`**——这是合法降级,不需要声明什么。
- **违约表现:** 无硬违约。但 eval 若断言图片内容,在忽略 files 的 agent 上必然失败——这是 eval 与 agent 的能力错配,报错落在断言上。

#### `t.newSession()`

- **运行器做什么:** **不调 adapter。** 只新建一条会话线(一个全新的 `ctx.session`);下一次在这个 session 上 `send` 时,adapter 看到的 `ctx.session.id` 是 `undefined`、`history().get()` 是空数组——这是新会话线的自然形态,不是需要 `if` 判断的分支。
- **adapter 义务:** 接了会话续接存取器的 adapter,新会话线上"自然发生"的就是开全新会话:`id` 未捕获过就不会往请求里塞 resume 参数,`history().get()` 为空就不会带历史。**不需要额外写判断逻辑**——存取器的初始状态本身就是正确行为。
- **违约表现:** 如果 adapter 没有正确使用存取器(比如用模块级变量而不是 `ctx.session` 保存会话状态,导致跨 session 串用同一份历史),"独立 session"会共享上下文,session 级断言全部失真且**没有任何报错**。写多轮 adapter 必须测这条。

#### `t.requireInputRequest(filter?)` / `session.requireInputRequest`

- **运行器做什么:** **不调 adapter。** 读该 session pending 列表(= **最近一轮** `Turn.events` 里的 `input.requested`;更早轮次的在下一次 send 时已被清空),要求**恰好一个**匹配 filter,返回它;不满足按 gate 失败并中止。
- **adapter 义务(发生在上一轮 `send` 里):** agent 停下等人输入时,返回 `status: "waiting"`,并且**每个待回答的问题吐一条 `input.requested`**,`request` 按上文 `InputRequest` 把 filter 能匹配的字段填上。
- **违约表现:** 只置 `waiting` 不吐事件 → `requireInputRequest` 找不到请求,直接 fail(响,但错误指向 eval 而不是 adapter);吐了多条却对应同一个问题 → "恰好一个"失败。

#### `t.respond(...responses)` / `t.respondAll(optionId)`

- **运行器做什么:** 清空 pending 列表,把每条回答翻成一条 `InputResponse`(`{ requestId, optionId }` 或 `{ requestId, text }`),**当作普通的下一轮 `send` 发给同一 session**——`input.responses` 携带结构化回答,`input.text` 是拼接的可读文本。`respondAll` = 对每个 pending 请求重复同一 `optionId`。
- **adapter 义务:** 按 `input.responses` 里的 `requestId` 把裁决交回应用(不要按顺序猜);CLI/服务有原生"回答待批准工具"协议的,在 `send` 里翻译过去。返回下一轮 `Turn`——可以又是 `waiting`(连环提问)。被人拒绝的调用,`action.result` 的 `status` 置 `"rejected"` 而不是 `"failed"`——拒绝是人的决定、不是工具故障,这样 `noFailedActions()` 不误伤,`calledTool(..., { status: "rejected" })` 可精确断言。
- **违约表现:** 忽略 `input.responses`、只解析 `input.text` 猜意图 → 多个请求并停时对不上号;把回答当成全新会话处理 → agent 根本不在等这个回答,后续断言全盘失真(静默)。

#### `setup` / `teardown`(不是 `t` API,但属于同一契约)

- **运行器做什么:** 备好沙箱(上传 / git 基线 / eval 级 setup)后、首次 `send` 前调一次 `setup`;`setup` 返回的 cleanup 和 `teardown` 都在 finally 跑。
- **adapter 义务:** `setup` 只做"每个沙箱一次"的事(装 CLI、写主配置、装 skill / plugin);失败应直接抛——那是 **errored**(基建问题),不是 agent 做题失败,见 [Skills / Plugins 的失败语义](coding-agent-skills-plugins.md#失败语义)。

### 断言族的数据义务(adapter 要「说」什么)

驱动 API 之外,每族断言消费一类数据。表格逐族列出:断言读什么、adapter 必须产出什么、数据缺失时的表现——**注意最后一列的"响 / 静默"之分**:

| 断言族 | 读什么 | adapter 义务 | 数据缺失时 |
|---|---|---|---|
| `succeeded()` / `parked()` / `turn.expectOk()` | `Turn.status` + 事件流(`parked` 看最后有意义事件是否 `input.requested`) | `status` 如实;HITL 停留吐 `input.requested` | `status` 恒 completed → `succeeded` **假通过(静默)** |
| `messageIncludes()` / `t.reply` / `turn.message` | `message` 且 `role: "assistant"` 的事件文本 | 每段助手文本吐一条 `message`(工具结果**不是**助手消息,别混,见[参考笔记的踩坑记录](reference/agent-eval.md#claude-code-怎么转换)) | 断言 fail(响) |
| `outputEquals()` / `outputMatches()` | `turn.data` | 结构化输出放 `data`,不要序列化塞进 `events` | fail(响) |
| `calledTool()` / `toolOrder()` / `loadedSkill()` / `calledSubagent()` | 派生 `toolCalls` / `subagentCalls` | 每次调用吐 `called` + `result`(callId 配对);`name` 原始名 + `tool` 规范名;result `status` 如实 | fail(响) |
| `notCalledTool()` / `usedNoTools()` / `maxToolCalls()` | 同上 | 同上——但这里靠的是**完整性** | **假通过(静默)** |
| `noFailedActions()` | 派生 status | `action.result.status` 区分 `failed` / `rejected`,不要一律 completed | **假通过(静默)** |
| `event()` / `eventOrder()` / `eventsSatisfy()` | 原始事件流 | 类型用标准词汇;时序保真,不合成、不重排 | `event` fail(响);`eventOrder` fail(响) |
| `notEvent()` | 原始事件流 | 同上——完整性 | **假通过(静默)** |
| `maxTokens()` / `maxCost()` | `Turn.usage` 逐轮累计 | 每轮尽量带 `usage`(transcript 里抠,见各 parser) | **假通过(静默)**(0 ≤ max 恒真) |

### 负断言的完整性规则

上表最后一列的规律值得单独立成一条设计规则:

> **正断言在数据缺失时"响"(fail,作者会去查);负断言与上限断言在数据缺失时"静默通过"。** `notCalledTool` / `notEvent` / `usedNoTools` / `maxToolCalls` / `maxTokens` / `maxCost` 在空流 / 半空流上全部恒真。所以事件完整性才是关键,而不是"尽力而为"——漏吐一半事件比完全不吐更危险:完全不吐时正断言会把问题暴露出来,漏吐一半时正断言碰巧通过、负断言全部假通过。**事件来源的完整性证据决定负断言的可信度**(见上文「能力从哪来」):官方转换器透传 SDK 原生事件流、或消费 Responses 这类承诺"输出即全过程"的协议,负断言可信;手写映射没有这份证明,做不到完整时,文档要如实说明这条 eval 的负断言结论不可全信,而不是假装它和正断言一样可靠。

## HITL 握手:一次完整时序

`t.respond` 能工作,靠三个义务同时成立:`waiting` 状态、`input.requested` 事件、回答按 `requestId` 交回应用。缺一的后果见上文逐 API 表。

```text
test(t)                              runner                       adapter.send
────────────────────────────────────────────────────────────────────────────────
await t.send("把服务部署到 prod")  → send#1(新会话线:ctx.session.id 为空)
                                                                  → 跑 agent;agent 停在部署确认上
                                   ← Turn{ status: "waiting",
                                           events: [..., input.requested{
                                             action: "deploy",
                                             options: [{id:"yes"},{id:"no"}] }] }
t.parked()                           ✓(最后有意义事件是 input.requested)
const req = t.requireInputRequest({ action: "deploy" })
                                     ✓(pending 列表恰好一条,返回 req)
await t.respond("yes")             → send#2(同一 ctx.session,
                                            input.responses: [{ requestId, optionId: "yes" }])
                                                                  → 按 requestId 把 "yes" 交回应用
                                   ← Turn{ status: "completed", events: [...] }
t.succeeded()                        ✓
```

## 三类配置的归属:本地配 / 实验传入 / ctx 透传

写 agent 最容易纠结「这个设置写哪」。规则固定:

| 设置 | 归属 | 怎么拿 |
|---|---|---|
| 鉴权(API key / token / base url) | **agent 本地** —— 它怎么连自己,是私事 | 在定义里读 env / 闭包,不经 ctx |
| CLI 细节(装什么包、参数形状、transcript 在哪) | **agent 本地** | 写死在 `send` / `setup` 里 |
| **model** | **实验决定(留空)** | `ctx.model`(省略 → agent 原生默认) |
| **feature flags**(webResearch、注入哪个 skill、effort…) | **实验决定** | `ctx.flags.*` —— agent 的 `send` 与 eval 的 `t.flags` 都能读 |
| runs / earlyExit / evals / sandbox / budget | **实验决定** | 运行器据此调度 |

一句话:**agent 只配「怎么连我自己」,不配「跑哪个模型、开哪些开关」**;后者全留给 [experiment](../experiments.md),经 `ctx`(eval 里是 `t`)透传。这样同一个 agent 能被不同实验以不同 model / flags 复用,不必改 agent。

## `ctx`(agent 侧)与 `t`(eval 侧):同一份东西,两个名字

`send` / `setup` 收到的叫 `ctx`,`test` 收到的叫 `t`。它们不是两套数据:**`t` 是运行器在 `ctx` 之上为 eval 作者搭的高层视图**——`t.send(...)` 内部就是拿着 `ctx` 去调 `agent.send(input, ctx)`。

| 概念 | `ctx`(agent:`send` / `setup`) | `t`(eval:`test`) | 关系 |
|---|---|---|---|
| 实验 flags | `ctx.flags` | `t.flags` | **同一份**(experiment 给) |
| 模型 | `ctx.model`(用来拼 `--model`) | `t.model`(只读,知道在测谁) | 同一份 |
| 取消信号 | `ctx.signal` | `t.signal` | 同一份 |
| 日志 | `ctx.log()` | `t.log()` | 同一个 |
| 会话 | `ctx.session`(存取器组,用来续接) | `t.newSession()`(发起新会话) | `t` 发起新会话线 → 运行器构造全新 `ctx.session` |
| 沙箱 | `ctx.sandbox`(底层 `Sandbox` 句柄) | `t.sandbox`(文件 IO / 命令 / 结果断言) | eval 作者看不到 `stop`;生命周期由 runner 管 |
| OTLP 端点 | `ctx.telemetry`(endpoint + 导出 env/headers) | —(trace 只出现在结果里) | 仅配置了 OTel 接入的 agent 有 |
| 一轮结果 | `send` 返回的 `Turn`(`events` 为核心) | `t.send()` 的返回 / `turn.outputEquals` | core 把 `Turn` 转交给 eval |
| 鉴权 / CLI 细节 | agent 本地(**不在 ctx**) | — | 谁都不暴露给对方 |
| 断言 / judge 派生 | — | `t.check` / `t.calledTool` / `t.judge.*` / `t.maxTokens`… | 只在 eval 侧 |

口诀:**`ctx` 是「驱动 AI」的低层上下文(agent 用),`t` 是「写断言」的高层上下文(作者用);共享 experiment 透传的那几样,其余各管一摊。**

## 相关阅读

- [Adapter 写法](authoring.md) —— remote / sandbox 示例、采集层、shared 工具、三段式拆解。
- [Assertions](../assertions.md) —— 这些断言在 eval 侧的完整参考(作用域 + 来源)。
- [Observability](../observability.md) —— transcript → 标准事件流的归一化、规范工具名、OTLP trace。
- [Experiments](../experiments.md) —— model / flags 怎么经 experiment 传进 ctx。
- [docs-site Adapter 概念](../../docs-site/zh/concepts/adapter.mdx) / [Tier](../../docs-site/zh/concepts/tier.mdx) —— 面向用户的同一份契约与三档接入。
