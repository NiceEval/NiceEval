# Adapter 契约 —— eval 调什么,adapter 返回什么

这一篇是 adapter 的**规范参考**:接口形状、能力位、标准事件流词汇,以及核心内容——**逐 `t` API 的适配义务表**:eval 作者每调一个 `t.*`,运行器把它翻成什么、adapter 必须返回什么、返回错了或缺了会以什么方式暴露。

怎么一步步把 adapter 写出来(分档递进、remote / sandbox 示例、采集层技巧)见 [Adapter 写法](authoring.md);Agent / Adapter 是什么、为什么没有 `--url` 见 [README](README.md)。

## Agent 契约

不管底下是进程内调用、HTTP、还是沙箱 CLI,所有 agent 对运行器暴露同一个契约:**接过一次输入,驱动被测对象,交回一个以标准事件流为核心的 `Turn`。** 以下与 `src/types.ts` 对齐:

```typescript
interface Agent {
  readonly name: string;                       // "my-bot" / "claude-code" / "codex"
  readonly capabilities: AgentCapabilities;
  setup?(sandbox: Sandbox, ctx: AgentContext): Promise<void | Cleanup> | void | Cleanup;
                                               // 每个沙箱一次:装 CLI / 写主配置;可返回 cleanup
  tracing?: AgentTracing;                      // OTLP 导出配置(仅 capabilities.tracing 有意义)
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;   // 每轮一次
  teardown?(sandbox: Sandbox, ctx: AgentContext): Promise<void> | void;  // 收尾清理(finally 跑)
}

interface TurnInput {
  readonly text: string;
  readonly files?: readonly InputFile[];  // 多模态附件;不支持的 adapter 忽略即可
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
  readonly sandbox: Sandbox;             // 沙箱型才有意义(运行器按 capabilities.sandbox 备好)
  readonly session: { id?: string; readonly isNew: boolean };  // id 可写:adapter 回传供下轮 resume
  readonly telemetry?: Telemetry;        // 仅 capabilities.tracing:OTLP 端点 + ready-to-spread env
  log(msg: string): void;
}
```

`send` 是**统一动词**,`Turn.events` 是**统一产物**。区别只在 `send` 内部怎么把原始返回变成 `events`——这就是 adapter 的核心难点。

![一次 t.send 的完整往返：eval 调用 t.send，运行器组装 TurnInput 与 ctx，adapter 调用你的应用并返回标准事件流 Turn。](../../docs-site/images/agent-turn-roundtrip-zh.svg)

`defineSandboxAgent` / `defineAgent`(见 `src/define.ts`)产出的都是这个 `Agent`,差别只在默认能力位(下一节)和语义:沙箱型的 `send` 在沙箱里 spawn CLI,remote 的 `send` 进程内调函数或发 HTTP。`setup` 装 CLI 这类"每个沙箱一次就够"的动作不要放 `send`——多轮时 `send` 会被调多次,放里面等于每轮重装。

## 能力位:每个位是一条承诺

`AgentCapabilities` 的每个位都是独立开关。声明一个位不是"打开功能",而是**向 eval 作者承诺一组适配义务**——义务的精确内容见下文逐 API 表:

| 位 | 承诺(adapter 义务) | 对应解锁 |
|---|---|---|
| `conversation` | `send` 可被多次调用:按 `ctx.session.isNew / id` 区分 fresh / resume,回写 `id` | `t.send` 多次、`t.reply`、`t.newSession()`、`t.respond`(还需 HITL 行为,见下) |
| `toolObservability` | `events` **完整**覆盖所有工具 / 子 agent 调用,`callId` 配对,时序保真 | `calledTool` / `toolOrder` / `event` 等整套作用域断言;**负断言从此可信** |
| `workspace` | agent 在工作区文件系统上产出(改文件是它的输出形态) | diff / 文件类断言有意义 |
| `sandbox` | 需要运行器备沙箱,经 `ctx.sandbox` 交付 | `t.sandbox`(文件 IO / 命令 / diff 断言) |
| `compactionObservability` | 能识别上下文压缩并吐 `compaction` 事件 | `t.event("compaction")`、o11y 的 `compactions` 计数 |
| `tracing` | 能经 OTLP 导出 trace(配 `tracing` 块 + span mapper) | `EvalResult.trace`、`niceeval view` 瀑布图 |

**现状注意(与目标设计的差距):**

- 能力位是 **opt-out** 的:`defineSandboxAgent` 默认给 `conversation + toolObservability + workspace + sandbox`,`defineAgent` 默认给 `conversation + toolObservability`。所以"声明"的实际动作往往是**做不到时显式关掉**;不关,负断言就会静默失真(见[负断言完整性规则](#负断言的完整性规则))。
- 早期文档说"没声明能力位,`t` 在类型层面就拿不到方法"。这是目标设计;现状 `TestContext` 是宽接口(被测项目经 `tsx` 运行,不做类型检查,见 [source-map 已知差异](../source-map.md#与设计文档的已知差异实现取舍)),运行时守卫只有 `t.sandbox` 有清晰报错,`conversation` / `toolObservability` 未守卫。
- HITL(`t.respond` 等)**没有自己的能力位**,是行为约定。修法见[能力守卫](#能力守卫没做到的实现怎么暴露目标设计)。

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
  | { type: "compaction"; reason?: string }                // 上下文压缩(compactionObservability)
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

- **运行器做什么:** 记一条 `message(role: "user")` 事件 → 调 `agent.send({ text }, ctx)`,`ctx.session` 绑定当前会话线 → 把返回 Turn 的 `events` / `usage` 累进该 session 和 run 级聚合,`input.requested` 事件收进该 session 的 pending 列表(**每次 send 前先清空**),`isNew` 置 `false`。
- **adapter 返回:** 一个 `Turn`。`events` 按时序、`status` 如实、能拿到就带 `usage`;`conversation` agent 把本轮会话 id 写回 `ctx.session.id`。
- **违约表现:** `events` 空 → 文本 / 工具断言全部无数据(正断言 fail、负断言假通过);`status` 恒 `"completed"` → `succeeded` 假通过、HITL 判定失效。

#### `t.sendFile(path, text?)` / `session.sendFile`

- **运行器做什么:** 读本地文件转 base64 → `agent.send({ text, files }, ctx)`,其余同 `send`。
- **adapter 义务:** 自行决定投递方式(remote 塞进请求体;沙箱型可写进沙箱再在 prompt 里引用路径)。不支持多模态就**忽略 `files`、照常跑 `text`**——没有能力位,忽略是合法降级。
- **违约表现:** 无硬违约。但 eval 若断言图片内容,在忽略 files 的 agent 上必然失败——这是 eval 与 agent 的能力错配,报错落在断言上。

#### `t.newSession()`

- **运行器做什么:** **不调 adapter。** 只新建一条会话线;下一次在这个 session 上 `send` 时,adapter 看到 `ctx.session = { id: undefined, isNew: true }`。
- **adapter 义务:** 见 `isNew === true` 必须**不带任何 resume 参数**、开全新会话,并把新会话 id 写回 `ctx.session.id`;后续轮 `isNew === false` 且 `id` 有值 → 必须 resume 到同一会话(CLI 有原生 `--resume <id>` 就直接接;没有就每轮自带完整上下文)。
- **违约表现:** 最危险的一种——忽略 `isNew` 一律 resume,"独立 session"实际共享上下文,session 级断言全部失真且**没有任何报错**。写多轮 adapter 必须测这条。

#### `t.requireInputRequest(filter?)` / `session.requireInputRequest`

- **运行器做什么:** **不调 adapter。** 读该 session pending 列表(= **最近一轮** `Turn.events` 里的 `input.requested`;更早轮次的在下一次 send 时已被清空),要求**恰好一个**匹配 filter,返回它;不满足按 gate 失败并中止。
- **adapter 义务(发生在上一轮 `send` 里):** agent 停下等人输入时,返回 `status: "waiting"`,并且**每个待回答的问题吐一条 `input.requested`**,`request` 按上文 `InputRequest` 把 filter 能匹配的字段填上。
- **违约表现:** 只置 `waiting` 不吐事件 → `requireInputRequest` 找不到请求,直接 fail(响,但错误指向 eval 而不是 adapter);吐了多条却对应同一个问题 → "恰好一个"失败。

#### `t.respond(...responses)` / `t.respondAll(optionId)`

- **运行器做什么:** 清空 pending 列表,把 `responses`(纯字符串:option id 或自由文本)用换行拼接,**当作普通的下一轮 `send` 发给同一 session**(`isNew === false`)。`respondAll` = 对每个 pending 请求重复同一 `optionId`。**adapter 看不到"这是回答"的显式标记**——它收到的就是一次带 resume 的 `send`。
- **adapter 义务:** resume 到暂停的那次会话,把文本作为人的回答交给 agent。CLI 有原生"回答待批准工具"协议的,在 `send` 里翻译过去;没有的,resume + 一条用户消息就是回答。返回下一轮 `Turn`——可以又是 `waiting`(连环提问)。
- **违约表现:** 不支持 resume → 回答落进一条全新会话,agent 根本不在等这个回答,后续断言全盘失真(静默)。

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

> **正断言在数据缺失时"响"(fail,作者会去查);负断言与上限断言在数据缺失时"静默通过"。** `notCalledTool` / `notEvent` / `usedNoTools` / `maxToolCalls` / `maxTokens` / `maxCost` 在空流 / 半空流上全部恒真。所以声明 `toolObservability` 承诺的是**完整性**而不是"尽力而为"——漏吐一半事件比完全不吐更危险:完全不吐时正断言会把问题暴露出来,漏吐一半时正断言碰巧通过、负断言全部假通过。做不到完整,就显式关掉这个位。

## HITL 握手:一次完整时序

`t.respond` 能工作,靠三个义务同时成立:`waiting` 状态、`input.requested` 事件、resume。缺一的后果见上文逐 API 表。

```text
test(t)                              runner                       adapter.send
────────────────────────────────────────────────────────────────────────────────
await t.send("把服务部署到 prod")  → send#1 (isNew=true)        → 跑 agent;agent 停在部署确认上
                                   ← Turn{ status: "waiting",
                                           events: [..., input.requested{
                                             action: "deploy",
                                             options: [{id:"yes"},{id:"no"}] }] }
t.parked()                           ✓(最后有意义事件是 input.requested)
const req = t.requireInputRequest({ action: "deploy" })
                                     ✓(pending 列表恰好一条,返回 req)
await t.respond("yes")             → send#2 (isNew=false, id=…,
                                            text="yes")          → resume 会话,把 "yes" 作为
                                                                    人的回答交回 agent
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
| 会话 | `ctx.session`(`id`/`isNew`,用来 resume) | `t.newSession()`(发起新会话) | `t` 发起 → 运行器置 `isNew` → `ctx` 执行 |
| 沙箱 | `ctx.sandbox`(底层 `Sandbox` 句柄) | `t.sandbox`(文件 IO / 命令 / 结果断言) | eval 作者看不到 `stop`;生命周期由 runner 管 |
| OTLP 端点 | `ctx.telemetry`(endpoint + 导出 env) | —(trace 只出现在结果里) | 仅 tracing agent 有 |
| 一轮结果 | `send` 返回的 `Turn`(`events` 为核心) | `t.send()` 的返回 / `turn.outputEquals` | core 把 `Turn` 转交给 eval |
| 鉴权 / CLI 细节 | agent 本地(**不在 ctx**) | — | 谁都不暴露给对方 |
| 断言 / judge 派生 | — | `t.check` / `t.calledTool` / `t.judge.*` / `t.maxTokens`… | 只在 eval 侧 |

口诀:**`ctx` 是「驱动 AI」的低层上下文(agent 用),`t` 是「写断言」的高层上下文(作者用);共享 experiment 透传的那几样,其余各管一摊。**

## 能力守卫:没做到的实现怎么暴露(目标设计)

eval 用了 adapter 没实现的能力(`t.respond` / `t.newSession` / `t.calledTool`…)时,应该在哪一层、以什么形式暴露?先说破一个结构性约束,再给设计。

### 为什么"编译期完整拦截"做不到

两个事实决定了上限:

1. **eval 不绑定 agent。** 同一份 eval 要能换着 agent 跑(experiment 晚绑定),写 eval 时类型系统不知道将来对着谁——`t` 无法按"那个 agent"的能力收窄。让 eval 显式声明 `requires: ["hitl"]` 可以换回编译期检查,但这条已被否掉(见[下文「eval 不声明 requires」](#跑之前能做多少编辑器--静态提示)):多维护一份声明,漂移后比没有更糟。
2. **被测项目经 `tsx` 运行,不做类型检查。** 就算类型收窄了,拦不住实际运行——类型层的价值只在**编辑器里**(hover / 红线),不在跑的时候。

所以:**主力是运行时守卫(调用点拦截,第一次调用就报),编辑器提示是辅助,不承担正确性。**

### 第一层:声明要诚实(守卫的前提)

守卫读的是 `capabilities`,声明撒谎守卫就是摆设。三条修正:

- **加 `hitl` 位,默认 off。** `t.respond` / `t.respondAll` / `t.requireInputRequest` / `t.parked` 改由它 gate(不再挂在 `conversation` 下隐含)。它是唯一必须 opt-in 的位——HITL 的三条义务(`waiting` / `input.requested` / resume 交回)没人能"碰巧做到"。
- **`defineAgent`(remote)的默认位收紧为空 `{}`。**(✅ 已落地,见 `src/define.ts`)默认送 `conversation + toolObservability` 会把守卫全部短路:一个没处理 resume 的进程内 agent,第二次 `t.send` 会**静默当成新对话**——这是守卫最该拦的场景,却被默认声明放行了。收紧后,T0 作者第一次调第二个 `t.send` 会得到明确报错,顺着报错去实现或声明,这正是想要的引导。能力 = 承诺:做到了什么就声明什么(`aiSdkAgent` 等内置工厂显式声明自己真做到的位)。
- **`defineSandboxAgent` 的默认位保留**(`conversation + toolObservability + workspace + sandbox`)——沙箱型 coding agent 这四样是题中之义,内置 adapter 也都真做到了;但文档义务同步收紧:**用默认位 = 承诺做到了这四样**,做不到显式关。

### 第二层:调用守卫(缺声明 → 立即报错,判 errored)

运行器构造 `t` 时已知 `agent.capabilities`,把每个受 gate 的 API 包一层检查——eval **第一次调用**没声明的 API 就抛,不等跑完:

| eval 调用 | 需要的位 | 现状 |
|---|---|---|
| 第二次 `t.send()` / `t.sendFile()`、`t.newSession()` | `conversation` | ✅ 已有调用守卫(第一次 send 不拦,第二轮起报清晰错误) |
| `t.respond` / `t.respondAll` / `t.requireInputRequest` | `hitl`(新) | 暂 gate 在 `conversation` 下(`hitl` 位未落地) |
| `t.calledTool` / `t.notCalledTool` / `t.toolOrder` / `t.usedNoTools` / `t.maxToolCalls` / `t.noFailedActions` / `t.calledSubagent` / `t.loadedSkill`(session / turn 句柄同套) | `toolObservability` | ✅ 已有调用守卫(第一次调用即报) |
| `t.sandbox.*`、`t.file` / `t.fileChanged` / `t.fileDeleted` / `t.notInDiff` / `t.noFailedShellCommands` | `sandbox` | ✅ 已有调用守卫 |

守卫实现见 `src/context/context.ts`(`capabilityGuard`),报错文案在 i18n `context.capabilityMissing`。

报错消息按 `t.sandbox` 的既有形状,**双向指路**——告诉 eval 作者换 agent,也告诉 adapter 作者实现什么:

```text
Eval "hitl/approve-email" called t.respond(), but agent "my-bot" does not declare capabilities.hitl.
→ 给 adapter 补实现:send 在 agent 等人输入时返回 status:"waiting" 并吐 input.requested 事件,
  resume 后把回答交回(见 docs/adapters/contract.md 的逐 API 义务),然后声明 hitl: true;
→ 或者把这条 eval 放进用支持 HITL 的 agent 的 experiment。
```

判决归 **errored**(接线错误),不是 failed(agent 做题差)——和 setup 失败同一语义。首错即抛也意味着不会刷屏:一次运行报第一处能力错配,修了声明其余守卫自然放行。

配套给一个**主动分支**的口子,让同一套 eval 有意跨档复用时不靠报错兜底:

```typescript
if (!t.supports("hitl")) return t.skip("agent 无 HITL,跳过审批流部分");
```

`t.supports(cap)` 只读 `agent.capabilities`,和守卫同一份数据。守卫拦"意外用错",`supports` 表达"故意降级",两者不冲突。

### 第三层:行为守卫(声明了但没做到 → 机检的报错,机检不了的警告)

声明只是承诺,跑起来还要对账。按可检程度分两级:

| 检查 | 时机 | 级别 |
|---|---|---|
| `status: "waiting"` 但 `events` 无 `input.requested`(或反之) | 每轮 send 返回后 | **error**(确凿矛盾,HITL 握手必断) |
| 声明 `toolObservability`,整个 attempt `events` 为空 | attempt 结束 | **warning**(可能真没调工具,但更可能解析器没接上) |
| 声明 `conversation`,多轮后 `ctx.session.id` 从未被回写 | 第二轮 send 前 | **warning**(无原生 resume 的 adapter 可以不写 id,自带上下文;但多数情况是忘了回传) |
| `action.called` 存在无配对 `action.result`(大面积) | attempt 结束 | **warning**(个别是正常截断,大面积是解析器漏了) |

warning 不改判决,但要**落进 `result.json` 的工件、console 报告和 view**,按 agent 去重——警告只在日志里滚过等于没警告。

彻底机检不了的(负断言完整性、事件被重排、`isNew` 被忽略后 resume 到旧会话)留给第四层。

### 跑之前能做多少:编辑器 + 静态提示

- **eval 不声明 `requires`。** 这是已定的取舍(见 [Assertions · 沙箱能力错误](../assertions.md#沙箱能力错误)):错误出现在实际用错的那行 API 上,比维护一份会漂移的能力清单更直接。守卫设计全部沿这条线,不回头。
- **编辑器提示走 JSDoc,不走类型收窄。** `t` 保持宽接口,但每个受 gate 的方法在类型定义上标注所需能力位(`@remarks 需要 agent 声明 capabilities.hitl`),hover 即见。类型收窄需要 eval 绑定 agent 泛型,与"eval 换着 agent 跑"冲突,不做。
- **`niceeval agent check <file>`(设计方向):adapter 一致性探针。** 真正"运行之前"能验证 adapter 的,不是编译器,是一个针对 adapter 的最小 conformance 探针:对被检 agent 跑一组机械检查——`send` 返回合法 `Turn`、声明 `toolObservability` 时事件非空且 `callId` 成对、声明 `conversation` 时连发两轮并检查 `isNew` 被消费 / `id` 被回写、声明 `hitl` 时检查 `waiting ↔ input.requested` 一致。写完 adapter 跑一次,比等 eval 撞上守卫更早。它检查的是**机械义务**(第三层那张表),不检查语义质量(回答对不对归 eval 管)。
- (可选,提示级)`--dry` / `list` 时对 eval 源码做轻量扫描(`t.respond` / `t.sandbox` 等 token),对照 experiment 绑定的 agent 给 lint 级提示。正则扫源码有假阴/假阳,只做提示不做 gate;有上面几层,这层可以不做。

### 静默层:守不住的,靠纪律 + 单测

负断言完整性、时序保真、事件语义正确——运行器无法知道 adapter **漏**了什么。这层靠本文档的纪律条款 + parser 的独立单测(采集 / 转换分层让 parser 可单测,见 [Adapter 写法 · 采集层](authoring.md#采集层原始数据怎么从-agent-cli-弄到手)),以及 `agent check` 探针里能覆盖的机械部分。

### 落地顺序建议

1. 调用守卫(第二层)+ `hitl` 位 + `t.supports()`——一处改动(构造 `t` 时包检查),收益最大。
2. `waiting ↔ input.requested` 一致性检查(第三层唯一的 error 级)。
3. warning 管道(工件 + console + view 展示)+ 其余 warning 检查。
4. `defineAgent` 默认位收紧(破坏性,和内置 adapter 显式声明一起做)。
5. `niceeval agent check` 探针。

## 相关阅读

- [Adapter 写法](authoring.md) —— 分档递进、remote / sandbox 示例、采集层、shared 工具。
- [Assertions](../assertions.md) —— 这些断言在 eval 侧的完整参考(作用域 + 来源)。
- [Observability](../observability.md) —— transcript → 标准事件流的归一化、规范工具名、OTLP trace。
- [Experiments](../experiments.md) —— model / flags 怎么经 experiment 传进 ctx。
