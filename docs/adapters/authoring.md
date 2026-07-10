# Adapter 写法 —— 递进式写出来,不用一次做全套

这一篇讲怎么把一个 adapter **写出来**:递进(每一步要写什么代码、解锁什么断言)、remote / sandbox 两个参考实现、采集层技巧、`shared` 工具袋。每个 `t` API 的精确适配义务(返回什么、违约怎么暴露)是规范内容,见 [Adapter 契约](contract.md)——写每一步之前先把对应义务读一遍。

## 递进:写什么解锁什么

写 adapter 不需要一次做全套。`t` 上解锁什么完全由**构造证据**决定(见[契约 · 能力从哪来](contract.md#能力从哪来构造证明不是问卷)),不是声明式的能力位——先做你已经做到的,其余留到需要时再补。**每一步解锁的是具体的 `t` 函数和断言,不是笼统的"更多能力"**,晚做后面几步不影响先跑起来的 eval,也不用改核心一行。

| 步骤 | adapter 要做什么 | 解锁的 `t` 函数 / 断言 |
|---|---|---|
| **1 · 收发消息** | 只实现 `send`,返回 `{ events: [], data, status }`。remote agent 把响应塞进 `data`;sandbox agent 按 `res.exitCode` 定 `status` | `t.send()`(单发一轮)、`t.sendFile()`(能调;文件是否起作用取决于 adapter 读不读 `TurnInput.files`)、`turn.outputEquals` / `outputMatches`、按 `status` 判的 `t.succeeded()` |
| **2 · 事件流** | 把原始返回映射成**完整**的 `StreamEvent[]`(callId 配对、时序保真、双名字,纪律见[契约 · 标准事件流](contract.md#标准事件流))。remote 在 `send` 里直接翻译;sandbox 加一个 transcript 解析器(`o11y/parsers/<name>.ts`) | 整套作用域断言:`calledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `messageIncludes` / `noFailedActions` / `calledSubagent` / `event` / `eventOrder` / `eventsSatisfy`;**负断言(`notCalledTool` / `notEvent`)的可信度取决于事件来源是否带完整性证明**,见[契约 · 负断言完整性规则](contract.md#负断言的完整性规则) |
| **3 · 多轮会话** | `send` 里接上 `ctx.session` 的续接存取器:`history<TMsg>()`(客户端带全量历史)或 `id` + `capture(id)`(服务端记历史)。新会话线的"第一轮"是存取器的自然空态(`history().get()` 空数组、`id` 为 `undefined`),不需要写判断分支 | `t.send()` 可多次、`t.reply`、`t.newSession()` |
| **4 · HITL** | 在第 3 步之上加两条行为:agent 停下等人时 `status` 置 `"waiting"`、每个待回答问题吐一条 `input.requested`(字段填法见[契约 · InputRequest](contract.md#inputrequesthitl-请求要填哪些字段));回答轮按 `input.responses` 里的 `requestId` 交回应用,读了一半的流现场用 `ctx.session.hold()` / `take()` 存取 | `t.parked()`、`t.requireInputRequest(filter?)`、`t.respond(...)` / `t.respondAll(optionId)` |
| **5 · tracing / OTel** | 一个 `tracing` 块(env-based 或 file-based 导出配置)+ 一个 span mapper(`o11y/otlp/mappers/<name>.ts`,归一到 canonical GenAI semconv)。remote agent 少见(没有独立进程可挂 exporter,一般跳过);没有 OTel 输出的 CLI 可从 transcript 时间戳合成 span,见 [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图) | `EvalResult.trace`、`niceeval view` 瀑布图,可跨 agent 叠加对比 |

一点提醒:**HITL 不是"事件流 + 多轮会话的交集"。** `input.requested` 是独立事件类型,不需要完整的工具可观测;HITL 真正依赖的是第 3 步的续接(`respond` 本质是拿着回答再发一轮,得靠同一条 session 续上)+ 上表那两条专门行为。三个义务缺一的具体后果,见[契约 · HITL 握手](contract.md#hitl-握手一次完整时序)。

以上五步是"接得上"到"要更细信号"的递进路径,不是要背的固定档位名字——**接入应用整体投入多大(要不要改应用内部代码)是另一个正交的问题,见 [docs-site · Tier](../../docs-site/zh/concepts/tier.mdx)**:那三档(Tier 1 只接 send / Tier 2 + OTel / Tier 3 侵入改造 + experiment flags)说的是"改不改被测应用",本篇这五步说的是"adapter 这一个文件里写多少代码"——同一个 Tier 1(应用零改动)的 adapter,也可以只做到第 1 步,或者一路做到第 5 步。两种坐标轴不要混着用同一套名字。

remote 和 sandbox 两种 `kind` 都不动核心一行——这是设计承重墙,见 [Vision](../vision.md)。

## 三段式:一个手写 send 里其实是三件互不相干的事

早期的 remote adapter 写法容易长成"一个 send 函数 + 一两百行手写 parser"——不是因为这件事本身复杂,是因为三类不同性质的问题被拧在同一个函数的局部变量和控制流里,谁都理不清、谁都没法单独复用。摊开看,真正互不相干的只有三段:

1. **transport(怎么发)。** 真做不掉,也不需要抽象——每家的 URL、鉴权、请求体形状本来就不一样。它应该只剩"发一个请求"这么单薄,不背着"顺便解析返回、顺便判断带不带 session id"这些逻辑。
2. **reduce(原始数据 → `StreamEvent[]`)。** 按数据到达的形状,收窄成两种官方 reducer,不用每接一个新后端就重写一个状态机:
   - **整段落地**——一帧就是一个完整单元,不需要拼接(Claude Agent SDK 的 `assistant` 帧、Codex SDK 的 `item.completed`、pi-agent-core 的 `message_end` 都是这种)。官方转换器 `fromClaudeSdkMessages` / `fromPiAgentEvents` / `fromCodexThreadEvents`(`sdk-streams.ts`)就是这一类,一种帧类型对应一段映射代码。
   - **逐 token / 逐参数增量**——文本和工具参数要靠 `callId`/index 拼接,遇到收尾信号才落地(原始 OpenAI/Anthropic 流式 API、自己手写的 token-by-token SSE 后端都是这个形状)。这类**优先用协议方自己的官方 reducer**(`uiMessageStreamAgent` 借用 `ai` 包的 `readUIMessageStream`,不是自己写状态机);没有官方 reducer 才用 `deltaStream(spec)`(`niceeval/adapter` 导出,见下)——一个通用的 buffer-by-id 累加器,你只声明"这一帧对应哪个操作",拼接时机它自己管。
   - OTel span **不是**第三种数据来源。事件流永远只从这两种官方 reducer 或手写映射来,OTel 只负责画 trace 瀑布图,和事件流完全独立(下文单独说)。
3. **编排:会话续接 + HITL 暂停恢复。** 这两件事和任何具体协议无关,纯粹是控制流模式,业界统共就两种会话模式、一种暂停恢复模式,不该每接一个新后端就重写一遍 `Map<sessionId, …>` + `if/else`。这两件事的存取器**直接挂在 `ctx.session`(`AgentSession`)上**,adapter 取用即可,不需要额外导入什么件或声明什么能力:

   | 存取器 | 解决什么 | 用在哪种后端 |
   |---|---|---|
   | `ctx.session.history<TMsg>()` | 会话续接·**客户端带全量历史**——服务端无状态、每轮发完整消息列表:`get()` 取当前历史(新会话线自然是空数组)、`commit(messages)` 写回最新完整列表 | 后端无状态、协议要求整段重发(OpenAI Chat Completions 这类;`uiMessageStreamAgent` 内部就是这个模式的一个特化) |
   | `ctx.session.id` + `ctx.session.capture(id)` | 会话续接·**服务端记历史**——发请求带 `ctx.session.id`(新会话线自然是 `undefined`)、后端回传 id 时 `capture(id)` 写回(只在还没记过时落地,不会被 resume 轮的重复回传覆盖) | 后端自己管会话历史(OpenAI Responses API、多数 SDK 的原生 session/thread) |
   | `ctx.session.hold(state)` / `ctx.session.take<T>()` | HITL 暂停恢复——`t.respond(...)` 对 adapter 而言就是一次带着回答的普通 `send`,adapter 得自己认出"这轮是不是接上次挂起的地方"。停轮时 `hold(state)` 存住现场(读了一半的流、待批准的 callId…),回答轮开头 `take()` 取回——取到即清除,一次消费 | 有 HITL 的后端(不管会话续接走哪种模式) |

   配合通用的 `driveFrameStream(cursor, reducer, ctx, onFrame?)`(逐帧喂 reducer、处理协议里混入的传输帧、检测 HITL 暂停信号,`niceeval/adapter` 导出),一个有 HITL 的无侵入 adapter 通常只剩这个形状(完整可跑参考见 [Tier 1 claude-sdk / pi-sdk 示例](https://github.com/CorrectRoadH/niceeval/tree/main/examples/zh/tier1)):

   ```ts
   function readStream(cursor: SseFrameCursor<Frame>, ctx: AgentContext, stream: MyStream) {
     return driveFrameStream(cursor, stream, ctx, (frame) => {
       if (isApprovalRequest(frame)) {
         ctx.session.hold({ cursor, stream, requestId: frame.id });
         return { pause: { id: frame.id, action: frame.action, options: [{ id: "approve" }, { id: "deny" }] } };
       }
     });
   }

   async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
     const held = ctx.session.take<{ cursor: SseFrameCursor<Frame>; stream: MyStream; requestId: string }>();
     if (held) {
       const optionId = input.responses?.find((r) => r.requestId === held.requestId)?.optionId;
       await postApprove(held.requestId, optionId === "approve");
       return readStream(held.cursor, ctx, held.stream);
     }
     const res = await fetch(/* … */);
     return readStream(sseJsonFrames<Frame>(res.body!), ctx, myReducer());
   }
   ```

   作者只写两件事:transport(`fetch` 那几行)、`onFrame` 里"这一帧要不要额外处理"的判断——循环、Map、状态机全部不用手写。

**OTel 完全不参与这三段,和事件流是两条独立的轨。** `Turn.events`(断言的唯一数据源)永远来自这三段——transport 发请求、reduce 把原始返回映射成事件、编排管会话续接和 HITL。OTel 只负责另一件事:把这一轮的 span 收集起来画进 `niceeval view` 的瀑布图,不产出任何事件、不影响任何断言、也不改变 `send` 的控制流。接 OTel 时 `send` 里唯一要碰的是把 `ctx.telemetry?.headers`(本轮的 W3C traceparent)spread 进请求头,让 span 能精确挂到这一轮——除此之外,`send` 该怎么读流、怎么处理审批帧、怎么续接会话,和有没有接 OTel 完全一样。详见 [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图) 与 [OTel 接入指南](../../docs-site/zh/guides/connect-otel.mdx)。

## remote agent:评你自己的服务

`send` 里发个 fetch,调你服务的接口。remote agent 都是 `defineAgent`:

```typescript
// agents/support-bot.ts —— URL 是它的私事(niceeval 不定协议)
import { defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  async send(input, ctx) {
    const r = await fetch(`${process.env.SUPPORT_BOT_URL}/chat`, {
      method: "POST", body: JSON.stringify({ message: input.text }), signal: ctx.signal,
    });
    const body = await r.json();
    return { events: toStreamEvents(body), data: body.output, status: "completed" };
  },
});
```

`toStreamEvents` 是你写的小映射:把你服务的"它说了啥、调了哪些工具"翻成标准事件。这是 remote agent 作者唯一的活——不需要写 `capabilities` 字段,`t` 上解锁什么由 `send` 实际做到了什么决定(见[契约 · 能力从哪来](contract.md#能力从哪来构造证明不是问卷))。

对是否该把 `send` 换成进程内直调你的函数(而不是走 HTTP),取舍见[接入你的 Agent · 为什么不直调](../../docs-site/zh/guides/connect-your-agent.mdx)——简言之:直调绕过了用户实际走的链路、进程不隔离导致结果不可复现、`ctx.signal` 的超时取消对进程内函数调用失效。niceeval 不禁止这么写(`Agent.kind` 仍然是 `"remote"`,契约不变),但官方文档和内置示例都不推荐它作为默认路径。

## sandbox agent:评 coding agent(claude-code / codex / bub)

它的"连接"不是 wire 协议,而是:在沙箱里 spawn agent 的 CLI、把 prompt 当参数丢进去、让它在沙箱文件系统上自己跑工具、跑完读回 transcript。

claude-code 和 codex 用**同一套**模型,绝大部分**共享**,只有 5 个点因 agent 而异:

| 步骤 | 共享? | claude-code | codex |
|---|---|---|---|
| 起沙箱 + 写入起始文件 + `git` 基线 | ✅ 共享(runner 固定段) | — | — |
| 装 CLI | ✗ | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` |
| 鉴权 | ✗ | env `ANTHROPIC_API_KEY` | `codex login --with-api-key` + profile |
| 拼调用 + 丢 prompt | ✗ | `claude --print [--model <m>] --dangerously-skip-permissions <prompt>` | `codex exec --profile default --json <prompt>` |
| 模型/参数 | ✗ | CLI flag `--model`(来自 `ctx.model`) | 写 `~/.codex/default.config.toml`(同) |
| 读 transcript → 解析成 events | ✗ | `~/.claude/projects/.../{session}.jsonl` 最新一个 | `--json` stdout 即 JSONL |
| 归一化 events → diff → 验证 | ✅ 共享 | — | — |

"共享"的部分由 niceeval 提供(runner 固定段 + 下文 [shared](#shared沙箱型-adapter-的工具袋)),所以**每个沙箱 adapter 真正要写的,就是中间那 5 行差异 + 一个 transcript 解析器**。内置 `claude-code` 的真实实现(`src/agents/claude-code.ts`)骨架:

```typescript
import { defineSandboxAgent, shared } from "niceeval/adapter";
import { requireEnv } from "niceeval";

// 鉴权是 agent 本地配置(见契约 · 三类配置的归属);注意「没有 model」——留空,实验决定
const auth = () => ({ ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") });

export default defineSandboxAgent({
  name: "claude-code",
  // 装 CLI 放 setup:每个沙箱一次,不随每轮 send 重装
  async setup(sb) {
    await sb.runShell("command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code");
  },
  // 运行器已备好沙箱(上传 / git 基线),经 ctx.sandbox 传入
  async send(input, ctx) {
    const sb = ctx.sandbox;

    const args = ["--print", "--dangerously-skip-permissions"];
    if (ctx.model) args.push("--model", ctx.model);              // 实验给了才传;否则用 CLI 原生默认
    if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch"); // 读实验参数
    if (ctx.session.id) args.push("--resume", ctx.session.id);   // 新会话线 id 为 undefined,自然不传

    const res = await sb.runCommand("claude", args, { env: auth() });

    // 采集(脏):磁盘旁读最新 JSONL;转换(净):shared.parseClaudeCode 只吃 raw 字符串
    const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects");
    ctx.session.capture(shared.sessionIdFromClaudeTranscript(raw));  // 回传供下轮续接(只在还没记过时落地)
    const parsed = shared.parseClaudeCode(raw);   // → { events, usage, … }
    return { events: parsed.events, usage: parsed.usage, status: res.exitCode === 0 ? "completed" : "failed" };
  },
});
```

接一个新 coding agent(比如 bub 之外的下一个)照抄此形状:换装法、换鉴权、换拼参、换 transcript 位置,再写一个解析器。

## 采集层:原始数据怎么从 agent CLI 弄到手

上面示例里 sandbox agent 靠 transcript JSONL 产事件流;但"怎么弄到这份原始数据"因 CLI 而异,是 `send` 里除了拼调用之外的另一半活。这里讲通用纪律;**每个 agent 具体走哪条路径、每个字段从原始数据的哪里抠,见 [采集矩阵](collection.md)**。三条实际路径,互不排斥,一个 agent 可能同时踩中好几条:

1. **磁盘旁读。** 多数 coding agent CLI 出于自己的会话续接(resume)需求,本来就会把完整交互写到磁盘——这不是它们为你设计的可观测性接口,只是"顺手"能读出来。claude-code 写 `~/.claude/projects/<project>/<session>.jsonl`,adapter 在 `send` 跑完后用 `shared.captureLatestJsonl(sandbox, dir)` 找最新一份读出来当 transcript。
2. **stdout/stderr 结构化捕获。** 给 CLI 传一个能让它打结构化日志的 flag(`--json` / `--format json`),把 `stdout + stderr` 拼起来当 transcript——本质上和"跑一条命令、把输出重定向到文件"没有区别。codex `codex exec --json` 走的是这条(配 `shared.extractJsonlFromStdout`)。
3. **OTLP 网络接收。** 前两条给的是"做了什么"(`StreamEvent[]`);trace 走独立通道——agent 经 OpenTelemetry 把 span **推**给运行器起的本机接收器,不是从文件/输出里"读"出来的(见 [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图))。

**采集层允许脏,转换层必须干净。** 具体路径、CLI flag、文件在哪、版本升级导致的格式漂移——这些都是没办法的事,注定要写一堆 per-agent 的 hack 和 fallback。但只要采集层的产出**统一收窄成"一个原始字符串 + 一个 agent 标识"**再交给转换层,转换层就可以完全不碰沙箱、不碰 CLI 细节,只做纯数据变换、可独立单测——`o11y/parsers/<agent>.ts` 的解析函数只接收 `raw: string`,签名里没有 `sandbox` 或 `ctx`,就是这条边界的直接体现。这条边界不是 niceeval 独创的直觉,是从分析 Vercel agent-eval 的实现里得到印证的模式,细节见 [agent-eval 参考:采集 / 转换 / 落地三层](reference/agent-eval.md)。

**容错:一行解析失败,不拖垮整份 transcript。** JSONL 逐行 `JSON.parse`,每一行单独 try/catch;某一行失败只把 `parseSuccess` 标 `false`,不中断——继续解析剩下的行,已经解析出的事件照常保留(见 [Observability](../observability.md#transcript--标准事件流))。

**一个 agent 的采集可以是多条互不相干的通道。** codex 用 stdout 当主 transcript,却另从磁盘 session 文件里读"实际用的模型"——按"这份数据要用来干什么"分别决定怎么采,不要假设一种机制满足所有需求(教训来自 [agent-eval 参考笔记](reference/agent-eval.md#采集层两份-parser-之前原始数据从哪来))。

## shared:沙箱型 adapter 的工具袋

跨沙箱 adapter 复用、不属于任何单个 agent 的逻辑,由 niceeval 从 `niceeval/adapter` 导出(`src/agents/shared.ts`):

- **采集辅助** —— `captureLatestJsonl(sandbox, dir)`(磁盘旁读最新 JSONL)、`extractJsonlFromStdout(stdout)`(stdout 捕获过滤)、`writeFile` / `appendFile` / `ensureInstalled`(setup 常用)。
- **会话 id 抽取** —— `sessionIdFromClaudeTranscript(raw)`、`codexThreadId(raw)`、`firstJsonField(raw, field)`(通用兜底)。
- **转换器** —— `parseClaudeCode(raw)` / `parseCodex(raw)` / `parseBub(raw)`:原始 JSONL → `{ events, usage, compactions, … }`,adapter 直接把结果铺进 `Turn` 返回。
- **后置组合** —— `registerMcp(agent, servers)`:给已构造的 claude-code / codex agent 追加 MCP server,不需要拿到原始 config 对象;条件包装器(只在某个实验变体上多挂一个 MCP server)用它而不必手写各家配置文件格式,细节见 [Coding Agent Skills / Plugins DX · 后置追加](coding-agent-skills-plugins.md#后置追加sharedregistermcp)。

git 基线与 diff 采集**不在 shared 里**——那是 runner 的固定段(沙箱创建时打一次基线、销毁前采一次 diff,见 `src/runner/sandbox-prep.ts`),对所有 agent 严格一致,adapter 不碰。中间"什么时候写入文件、什么时候调 `t.send()`、什么时候手工跑校验命令"全部由 eval 的 `test(t)` 自己决定,见 [Eval Authoring · 沙箱型](../eval-authoring.md#沙箱型手工把文件放进沙箱)。

## 没有注册表

没有按名字选 agent 的注册表——一个 config 文件对应一个(或一组固定的)agent,内置 coding-agent(`claude-code` / `codex` / `bub`)从 `niceeval/adapter` 导出,在 experiment 文件里直接引用。要换 agent 或 model,复制一个 experiment 文件改配置,不是靠 `--agent` 这类运行时选择器。

## 相关阅读

- [Adapter 契约](contract.md) —— 逐 API 的适配义务、事件流纪律、违约暴露方式。
- [Coding Agent Skills / Plugins DX](coding-agent-skills-plugins.md) —— 沙箱型 adapter 怎么装 skill / plugin 并组织 A/B 实验。
- [Observability](../observability.md) —— transcript 归一化、规范工具名、OTLP trace、usage / cost。
- [Sandbox](../sandbox.md) —— 沙箱接口与后端;adapter 只通过 `Sandbox` 接口和它交互。
- [agent-eval 参考](reference/agent-eval.md) —— 别人怎么做同一件事的源码阅读记录。
