# Agents 与 Adapters

这一篇讲 fasteval 如何"连到一个被测对象"。这是整个库最容易被想歪的地方,先把两个核心论点摆出来:

> 1. **fasteval 不定义任何 agent 协议。** 每一个被测对象 —— 你自己的 agent、你的后端服务、Claude Code / Codex 这种 coding agent —— **都是自己实现的 adapter**。experiment 引用 agent,而不是给一个 url。
> 2. **adapter 真正的难点不是"连上",而是把各 agent 五花八门的原始返回归一化成一套标准的[事件流](#标准事件流adapter-的核心难点)。** 归一化之后,整套断言都是免费的、与 agent 无关的。

两个词:

- **Agent** —— 抽象。fasteval 眼里"一个被测对象",带[能力位](#能力位决定-t-的形状),由 experiment 引用。运行器只认 Agent 契约。
- **Adapter** —— 实现。某个 agent 的具体代码,**由用户编写**(fasteval 也内置几个常用 coding agent)。一个 Adapter 实现一个 Agent。

按 transport 分两种,但**能力完全一样**(都能 `send`、都返回同一套标准结果):

- **remote agent**(`defineAgent`)—— 你在 `send` 里直接驱动:进程内调你的函数,或按你服务的协议发 HTTP。
- **sandbox agent**(`defineSandboxAgent`)—— 在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。

## 为什么是 experiment 选 agent,不是 `--url`

eve 能用一个 url 当被测对象,是因为它**定义了一套自己的协议**、被测 agent 恰好会说 —— 于是"连哪"退化成"哪个 url"。fasteval 没有这个前提:不存在一套通用协议让任意 agent 都会说。所以:

- **没有 `--url`、没有通用的 "http agent"。** 要连你的 HTTP 服务,你写一个 agent,它内部知道你服务的协议(URL、鉴权、消息格式都是它的私事)。
- **agent 写进 experiment。** "评本地 vs 评线上"靠 agent 自己读 env,或写成两个 experiment / 两个 agent 配置:

```sh
npx fasteval exp local weather   # 评本地
npx fasteval exp prod weather    # 评线上
```

## Agent 契约

不管底下是进程内调用、HTTP、还是沙箱 CLI,所有 agent 对运行器暴露同一个契约:**接过一次输入,驱动被测对象,交回一个以标准事件流为核心的 `Turn`。**

```typescript
interface Agent {
  readonly name: string;                       // "my-bot" / "claude-code" / "codex"
  readonly capabilities: AgentCapabilities;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
}

interface AgentCapabilities {
  conversation?: boolean;        // 支持多轮 send → t.send 多次
  toolObservability?: boolean;   // 能产出 action.* 事件 → t.calledTool
  sandbox?: boolean;             // 在沙箱文件系统上工作 → t.sandbox(文件 IO / 命令 / 结果断言)
  tracing?: boolean;             // 能经 OTLP 导出 trace → fasteval view 画瀑布图,见 Observability
}

interface AgentContext {
  readonly signal: AbortSignal;
  readonly model?: ModelTier;            // 由 experiment 给;省略 → 用 agent 原生默认
  readonly flags: Readonly<Record<string, unknown>>; // experiment 的 feature flags,透传给 agent
  readonly sandbox?: Sandbox;            // 仅沙箱型 agent 有(运行器按 --sandbox 备好)
  readonly session: { id?: string; readonly isNew: boolean }; // 多轮 resume / newSession 用
  log(msg: string): void;
}

interface Turn {
  readonly events?: StreamEvent[];  // 标准事件流 —— 一切作用域/工具断言的唯一数据源;省略 = []
  readonly data?: unknown;          // 结构化输出(供 outputEquals / outputMatches),与 events 独立
  readonly status: "completed" | "failed" | "waiting"; // waiting = 停在 HITL 输入上(parked)
  readonly usage?: Usage;           // token 用量(见 Observability)
  // message / toolCalls 不手填:都从 events 派生。不产 events 则 calledTool / messageIncludes 等无数据可读
}
```

`send` 是**统一动词**,`Turn.events` 是**统一产物**。区别只在 `send` 内部怎么把原始返回变成 `events` —— 这就是 adapter 的核心难点。`events` 是必填字段:纯 data agent(只回结构化输出、只用 `turn.outputEquals` / `turn.data`)可以传空数组 `[]`;但一旦要用 `calledTool` / `messageIncludes` / `succeeded` 这类作用域断言,就必须把原始返回映射成非空 `events`,否则这些断言没有数据可读。

## SandboxAgent 契约

沙箱型 agent 用 `defineSandboxAgent` 定义,在 `Agent` 契约之上多两样:一次性的 `setup`(装 CLI / 写主配置)和可选的 `tracing`(OTLP 导出配置)。`sandbox` 能力由 `defineSandboxAgent` 隐含,无需在 `capabilities` 里再写。

```typescript
interface SandboxAgent {
  readonly name: string;
  readonly capabilities: AgentCapabilities;   // sandbox 隐含;按需叠加 conversation / toolObservability / tracing
  setup?(sandbox: Sandbox, ctx: AgentContext): Promise<void>;  // 装 CLI、写主配置;每个 attempt 一次,在首次 send 前
  tracing?: AgentTracing;                      // 可选:OTLP 导出配置(见 Observability)
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
}
```

装 CLI 这类"每个 attempt 一次就够"的动作放 `setup`,不要放 `send` —— 多轮时 `send` 会被调多次,装在里面等于每轮重装。

## 标准事件流:adapter 的核心难点

你能写的那一整套断言:

```
t.succeeded() / t.parked() / t.messageIncludes() / turn.outputEquals() / turn.outputMatches()
t.calledTool() / t.loadedSkill() / t.notCalledTool() / t.toolOrder() / t.usedNoTools() / t.maxToolCalls()
t.noFailedActions() / t.calledSubagent() / t.event() / t.notEvent() / t.eventOrder() / t.eventsSatisfy()
```

**全部建立在一条标准的、带类型的事件流上**(对标 eve 的 `HandleMessageStreamEvent[]` 与 `deriveRunFacts`)。adapter 唯一的硬活,就是把这个 agent 的原始输出映射成这条流;映射完,上面所有断言都是 core 算的,与 agent 无关。

### 标准事件词汇

```typescript
type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string }
  | { type: "action.called"; callId: string; name: string; input: JsonValue }      // 工具 / 技能调用发起
  | { type: "action.result"; callId: string; output?: JsonValue;
      status: "completed" | "failed" | "rejected" }                                 // 与 called 按 callId 配对
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }   // 子 agent 委派
  | { type: "subagent.completed"; callId: string; output?: JsonValue;
      status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }   // HITL:agent 停下等人输入
  | { type: "thinking"; text: string }
  | { type: "error"; message: string };
```

技能加载(`load_skill`)就是一种 `action.called`,所以 `t.loadedSkill` 只是 `t.calledTool("load_skill", …)` 的语法糖,无需单独事件类型。

### 派生事实(core 算,共享,agent 无关)

core 的 `deriveRunFacts(events)` 把扁平事件流折叠成结构化事实 —— 这步对所有 agent 一样:

```typescript
interface DerivedFacts {
  readonly toolCalls: ToolCall[];         // action.called + action.result 按 callId 合并,带最终 status
  readonly subagentCalls: SubagentCall[]; // subagent.called + completed 合并,带 remoteUrl
  readonly inputRequests: InputRequest[];
  readonly parked: boolean;               // 最后一个有意义事件是 input.requested(干净停在 HITL)
  readonly messageCount: number;
}
```

### 每条断言落在哪

| 断言 | 数据来源 |
|---|---|
| `succeeded` / `parked` | 派生:无失败动作且未 park / `parked` |
| `messageIncludes(token)` | 作用域断言:所有 assistant `message` 事件文本拼接(跨全部轮) |
| `outputEquals` / `outputMatches` | `turn.data`(结构化输出) |
| `calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `loadedSkill` | 派生 `toolCalls` |
| `noFailedActions` | 派生:`toolCalls` + `subagentCalls`(+技能)均无 `failed` |
| `calledSubagent(name, opts)` | 派生 `subagentCalls`(可匹配 `remoteUrl`、输出) |
| `event` / `notEvent` / `eventOrder` / `eventsSatisfy` | 原始 `events` 流,直接查类型/数据/顺序 |

### 谁来产这条流

| agent kind | 怎么产 `events` |
|---|---|
| **sandbox agent** | transcript JSONL → `o11y/parsers/<name>.ts` 解析成 `StreamEvent[]`(token 用量也从这抠) |
| **remote / 进程内 agent** | 你在 `send` 里把自己的响应映射成 `StreamEvent[]`(或直接 emit) |

> **一句话:归一化一次(原始 → 标准事件流),整套断言词汇免费拿到。** sandbox agent 和 remote agent 的契约**完全相同**,只是产流方式不同 —— 这就是"能力一样、只是 kind 不同"的实质。

### 采集层:原始数据怎么从 agent CLI 弄到手

上面"谁来产这条流"说 sandbox agent 靠 transcript JSONL;但"怎么弄到这份原始数据"因 CLI 而异,是 `send` 里除了拼调用之外的另一半活。三条实际路径,互不排斥,一个 agent 可能同时踩中好几条:

1. **磁盘旁读。** 多数 coding agent CLI 出于自己的会话续接(resume)需求,本来就会把完整交互写到磁盘——这不是它们为你设计的可观测性接口,只是"顺手"能读出来。claude-code 写 `~/.claude/projects/<project>/<session>.jsonl`,adapter 在 `send` 跑完后用 `shared.captureLatestJsonl(sandbox, dir)` 找最新一份读出来当 transcript(见下文 [sandbox agent 示例](#sandbox-agent评-coding-agentclaude-code--codex--bub))。
2. **stdout/stderr 结构化捕获。** 给 CLI 传一个能让它打结构化日志的 flag(`--json` / `--format json`),把 `stdout + stderr` 拼起来当 transcript——本质上和"跑一条命令、把输出重定向到文件"没有区别。codex `codex exec --json` 走的是这条。
3. **OTLP 网络接收。** 前两条给的是"做了什么"(`StreamEvent[]`);trace 走独立通道——agent 经 OpenTelemetry 把 span **推**给运行器起的本机接收器,不是从文件/输出里"读"出来的(见 [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图))。

**采集层允许脏,转换层必须干净。** 具体路径、CLI flag、文件在哪、版本升级导致的格式漂移——这些都是没办法的事,注定要写一堆 per-agent 的 hack 和 fallback。但只要采集层的产出**统一收窄成"一个原始字符串 + 一个 agent 标识"**再交给转换层,转换层就可以完全不碰沙箱、不碰 CLI 细节,只做纯数据变换、可独立单测——`o11y/parsers/<agent>.ts` 的解析函数只接收 `raw: string`,签名里没有 `sandbox` 或 `ctx`,就是这条边界的直接体现。这条边界不是 fasteval 独创的直觉,是从分析 Vercel agent-eval 的实现里得到印证的模式,细节见 [agent-eval 参考:采集 / 转换 / 落地三层](ref/agent-eval.md)。

**容错:一行解析失败,不拖垮整份 transcript。** JSONL 逐行 `JSON.parse`,每一行单独 try/catch;某一行失败只把 `parseSuccess` 标 `false`,不中断——继续解析剩下的行,已经解析出的事件照常保留(见上文"归一化失败不崩")。

## 两种 agent,同一套契约

### remote agent(评你自己的 agent / 函数 / 服务)

进程内最快零网络;远程就是 `send` 里发个 fetch。两者都是 `defineAgent`,差别只在 `send` 内部:

```typescript
// agents/my-agent.ts —— 进程内
import { defineAgent } from "fasteval/adapter";
import { myAgent } from "../src/agent.js";

export default defineAgent({
  name: "my-agent",
  capabilities: { conversation: true, toolObservability: true },
  async send(input, ctx) {
    const res = await myAgent.handle(input.text, { signal: ctx.signal });
    // 把你的返回映射成标准事件流;message/toolCalls 由 core 从 events 派生
    return { events: toStreamEvents(res), data: res.json, status: "completed" };
  },
});
```

```typescript
// agents/support-bot.ts —— 远程,URL 是它的私事(fasteval 不定协议)
export default defineAgent({
  name: "support-bot",
  capabilities: { conversation: true, toolObservability: true },
  async send(input, ctx) {
    const r = await fetch(`${process.env.SUPPORT_BOT_URL}/chat`, {
      method: "POST", body: JSON.stringify({ message: input.text }), signal: ctx.signal,
    });
    const body = await r.json();
    return { events: toStreamEvents(body), data: body.output, status: "completed" };
  },
});
```

`toStreamEvents` 是你写的小映射:把你服务的"它说了啥、调了哪些工具"翻成标准事件。这是 remote agent 作者唯一的活。

### sandbox agent(评 coding agent:claude-code / codex / bub)

它的"连接"不是 wire 协议,而是:在沙箱里 spawn agent 的 CLI、把 prompt 当参数丢进去、让它在沙箱文件系统上自己跑工具、跑完读回 transcript。`send` 单发(一个 prompt → 一次完整运行)。

claude-code 和 codex 用**同一套**模型,绝大部分**共享**,只有 5 个点因 agent 而异:

| 步骤 | 共享? | claude-code | codex |
|---|---|---|---|
| 起沙箱 + 写入起始文件 + `git` 基线 | ✅ 共享 | — | — |
| 装 CLI | ✗ | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` |
| 鉴权 | ✗ | env `ANTHROPIC_API_KEY` | `codex login --with-api-key` + profile |
| 拼调用 + 丢 prompt | ✗ | `claude --print [--model <m>] --dangerously-skip-permissions <prompt>` | `codex exec --profile default --json <prompt>` |
| 模型/参数 | ✗ | CLI flag `--model`(来自 `ctx.model`) | 写 `~/.codex/default.config.toml`(同) |
| 读 transcript → 解析成 events | ✗ | `~/.claude/projects/.../{session}.jsonl` 最新一个 | `--json` stdout 即 JSONL |
| 归一化 events → diff → 验证 | ✅ 共享 | — | — |

"共享"的部分由 fasteval 提供成可复用工具(下文 [shared](#shared沙箱型-adapter-的共享工具)),所以**每个沙箱 adapter 真正要写的,就是中间那 5 行差异 + 一个 transcript 解析器**。

```typescript
// agents/claude-code.ts(内置;接 bub 照抄此形状)
import { defineSandboxAgent, shared } from "fasteval/adapter";
import { requireEnv } from "fasteval";

// 本地配:这个 agent 怎么连它自己 —— 鉴权在这里读;注意「没有 model」(留空,实验决定)
const auth = () => ({ ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") });

export default defineSandboxAgent({
  name: "claude-code",
  capabilities: { conversation: true, toolObservability: true }, // sandbox 由 defineSandboxAgent 隐含
  // 装 CLI 放 setup:每个 attempt 一次,不随每轮 send 重装
  async setup(sb) {
    await sb.runCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
  },
  // 运行器已用 shared 把沙箱备好(上传 / git 基线),通过 ctx.sandbox 传入
  async send(input, ctx) {
    const sb = ctx.sandbox!;

    const args = ["--print", "--dangerously-skip-permissions"];
    if (ctx.model) args.push("--model", ctx.model);              // 实验给了才传;否则用 CLI 原生默认
    if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch"); // 读实验 feature flag
    if (!ctx.session.isNew && ctx.session.id) args.push("--resume", ctx.session.id); // 多轮续接
    args.push(input.text);

    const res = await sb.runCommand("claude", args, { env: auth() });
    const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects");
    ctx.session.id = shared.sessionIdFromClaudeTranscript(raw);   // 回传供下轮 resume
    return {
      events: parseClaudeCode(raw),  // ← 原始 JSONL → 标准 StreamEvent[](adapter 的核心活)
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },
});
```

### 三类配置的归属:本地配 / 实验传入 / ctx 透传

写 agent 最容易纠结「这个设置写哪」。规则固定:

| 设置 | 归属 | 怎么拿 |
|---|---|---|
| 鉴权(API key / token / base url) | **agent 本地** —— 它怎么连自己,是私事 | 在定义里读 env / 闭包,不经 ctx |
| CLI 细节(装什么包、参数形状、transcript / 私人记忆在哪) | **agent 本地** | 写死在 `send` / `readMemory` 里 |
| **model** | **实验决定(留空)** | `ctx.model`(省略 → agent 原生默认) |
| **feature flags**(webResearch、注入哪个 skill、effort…) | **实验决定** | `ctx.flags.*` —— agent 的 `send` 与 eval 的 `t.flags` 都能读 |
| runs / earlyExit / evals / sandbox / budget | **实验决定** | 运行器据此调度 |

一句话:**agent 只配「怎么连我自己」,不配「跑哪个模型、开哪些开关」**;后者全留给 [experiment](../experiments.md),经 `ctx`(eval 里是 `t`)透传。这样同一个 agent 能被不同实验以不同 model / flags 复用,不必改 agent。

## 能力位决定 `t` 的形状

`test(t)` 收到的 `t` 是**按 agent 能力组装**的(见 [Architecture](../architecture.md#t-上下文能力决定形状)):

- 任意 agent → `t.send` / `t.sendFile` / `t.check` / `t.require` / `t.judge` / `t.log` / `t.skip`。`sendFile` 不需要单独的能力位——`TurnInput.files` 一直都在,adapter 不支持多模态就单纯忽略它,不影响这轮跑下去。
- `conversation` → `t.send` 可多次、`t.reply`、`t.newSession`。
- `toolObservability` → `t.calledTool` / `t.toolOrder` / `t.usedNoTools` / `t.calledSubagent` / `t.event`…。
- `conversation` **+** `toolObservability`(且 adapter 专门吐出 `input.requested` 事件、`status` 置 `waiting`)→ HITL:`t.parked` / `t.requireInputRequest` / `t.respond` / `t.respondAll`。这是两个能力位的交集,不是单开 `conversation` 就有,见下文[分档表](#接一个新-agent分档递进不用一次做全套)。
- `sandbox`(沙箱型)→ `t.sandbox`(文件 IO / 命令执行 / 结果断言和 diff)/ 手工在沙箱里跑验证命令。评 sandbox 产物用 `t.judge.autoevals.closedQA` 配 `{ on: t.sandbox.diff.get(path) }`。

作者写 `t.calledTool` 时若 agent 没声明 `toolObservability`,在类型层面就拿不到这个方法,不会跑起来才报错。

### `ctx`(agent 侧)与 `t`(eval 侧):同一份东西,两个名字

`send` / `setup` 收到的叫 `ctx`,`test` 收到的叫 `t`。它们不是两套数据:**`t` 是运行器在 `ctx` 之上为 eval 作者搭的高层视图** —— `t.send(...)` 内部就是拿着 `ctx` 去调 `agent.send(input, ctx)`。

| 概念 | `ctx`(agent:`send` / `setup`) | `t`(eval:`test`) | 关系 |
|---|---|---|---|
| 实验 flags | `ctx.flags` | `t.flags` | **同一份**(experiment 给) |
| 模型 | `ctx.model`(用来拼 `--model`) | `t.model`(只读,知道在测谁) | 同一份 |
| 取消信号 | `ctx.signal` | `t.signal` | 同一份 |
| 日志 | `ctx.log()` | `t.log()` | 同一个 |
| 会话 | `ctx.session`(`id`/`isNew`,用来 resume) | `t.newSession()`(发起新会话) | `t` 发起 → 运行器置 `isNew` → `ctx` 执行 |
| 沙箱 | `ctx.sandbox`(底层 `Sandbox` 句柄) | `t.sandbox`(文件 IO / 命令执行 / 结果断言) | eval 作者看不到 `stop`;生命周期由 runner 管 |
| 一轮结果 | `send` 返回的 `Turn`(`events` 为核心) | `t.send()` 的返回 / `t.reply` / `turn.outputEquals` | core 把 `Turn` 转交给 eval |
| 鉴权 / CLI 细节 | agent 本地(**不在 ctx**) | — | 谁都不暴露给对方 |
| 断言 / judge 派生 | — | `t.check`/`t.calledTool`/`t.judge.autoevals.*`/`t.maxTokens`… | 只在 eval 侧 |

口诀:**`ctx` 是「驱动 AI」的低层上下文(agent 用),`t` 是「写断言」的高层上下文(作者用);共享 experiment 透传的那几样,其余各管一摊。**

## Agent × Sandbox 正交

```text
experiment.agent    选「连哪个被测对象」(自实现的 adapter)
--sandbox <backend> 选「沙箱型 agent 在哪跑」(docker / vercel / 三方)
```

任意沙箱型 agent × 任意 sandbox 后端自由组合:`claude-code` 可跑 docker 也可跑 vercel;同一个 docker 沙箱可跑 `claude-code` 也可跑 `bub`。运行器按 experiment / `--sandbox` 备好 `Sandbox` 交给 `ctx.sandbox`,二者只通过 `Sandbox` 接口交互。remote agent 忽略 sandbox。详见 [Sandbox](../sandbox.md)。

## shared:沙箱型 adapter 的共享工具

跨所有沙箱 adapter 复用、不属于任何单个 agent 的逻辑,由 fasteval 提供(对应 agent-eval 的 `shared.ts`),保证所有 coding agent 的"打基线 / 采 diff / 抓 transcript"严格一致:

- **`initGitBaseline(sandbox)`** —— `git init && commit` 打一次空基线,供之后 `t.sandbox.diff` / `t.sandbox.fileChanged` 对比。跟"放了什么文件"无关——不管你在 `test()` 里写入了什么、写了没有,基线随沙箱创建自动打好。
- **`captureGeneratedFiles(sandbox)`** —— `git diff HEAD` 得到 `{ generated, deleted }`。
- **`injectO11yContext(sandbox, events)`** —— 由标准事件流派生 o11y,写 `__fasteval__/results.json`,供你在沙箱里手工跑的验证测试断言 agent 的行为。
- **`captureLatestJsonl(sandbox, dir)`** / transcript 定位辅助。

这些都是**给 adapter 作者复用的工具函数**,不是运行器包在 `agent.send()` 外面的固定编排——除了"沙箱创建时打一次 git 基线、销毁前采一次 diff"这两头是核心自动做的,中间"什么时候写入文件、什么时候调 `t.send()`、什么时候手工跑校验命令"全部是 eval 的 `test(t)` 自己决定,见 [Eval Authoring · 沙箱型](../eval-authoring.md#沙箱型手工把文件放进沙箱)。

没有按名字选 agent 的注册表——一个 config 文件对应一个(或一组固定的)agent,内置 coding-agent(`claude-code` / `codex` / `bub` …)从 `fasteval/adapter` 导出,在 experiment 文件里直接引用。要换 agent 或 model,复制一个 experiment 文件改配置,不是靠 `--agent` 这类运行时选择器。

## 接一个新 agent:分档递进,不用一次做全套

`AgentCapabilities` 每个位都是独立开关:先声明你已经做到的,其余留到需要时再补——**每一档解锁的是具体的 `t` 函数和断言,不是笼统的"更多能力"**,断言词汇和 `fasteval view` 随你声明的能力自动增减,不用改核心一行,也不用推翻已经写好的 eval。

| 档位 | adapter 要做什么 | 解锁的 `t` 函数 / 断言 |
|---|---|---|
| **T0 · 收发消息** | 只实现 `send`,返回 `{ status, data }`(`events` 留 `[]`)。remote agent 把响应塞进 `data` 就行;sandbox agent 按 `res.exitCode` 定 `status` | `t.send()`(单发一轮)、`t.sendFile()`(能调,但文件是否真起作用取决于 adapter 读不读 `TurnInput.files`)、`turn.outputEquals` / `turn.outputMatches`、按 `status` 判的 `t.succeeded()` |
| **T1 · 工具可观测** | 声明 `capabilities.toolObservability`,把原始返回映射成非空 `StreamEvent[]`。remote agent 在 `send` 里直接翻译;sandbox agent 加一个 [transcript 解析器](../observability.md#transcript--标准事件流)(`o11y/parsers/<name>.ts`) | [标准事件流](#标准事件流adapter-的核心难点)整套:`calledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls` / `messageIncludes` / `noFailedActions` / `calledSubagent` / `event` / `notEvent` / `eventOrder` / `eventsSatisfy` |
| **T2 · 多轮会话** | 声明 `capabilities.conversation`,`send` 按 `ctx.session.id` 支持 resume。CLI 有原生 `--resume <id>` 之类的续接参数就直接接;没有就每轮老实带上下文 | `t.send()` 可调用多次、`t.reply`、`t.newSession()` |
| **HITL(T1 + T2 的交集)** | 在 T1、T2 都做到的基础上,再加一条 T1/T2 都没单独要求的行为:agent 停下等人输入时,`send` 要返回 `status: "waiting"`,并在 `events` 里专门吐一条 `input.requested`(带 `InputRequest`:工具名 / input / prompt / display / optionIds) | `t.parked()`、`t.requireInputRequest(filter?)`、`t.respond(...)` / `t.respondAll(optionId)`(内部就是拿用户选的 option 再调一次 `send`,靠 T2 的 resume 续上) |
| **T3 · tracing/OTel** | 声明 `capabilities.tracing` + 一个 `tracing` 块(env-based 或 file-based 导出配置)+ 一个 span mapper。remote agent 少见(没有独立进程可挂 exporter,一般跳过);sandbox agent 的 mapper(`o11y/otlp/mappers/<name>.ts`)把原生 span 归一到 canonical GenAI semconv,没有 OTel 输出的(如 claude-code)可从 transcript 时间戳合成 span,见 [Observability · OTLP traces](../observability.md#otlp-traces--统一瀑布图) | `EvalResult.trace`、`fasteval view` 的瀑布图,可跨 agent 叠加对比 |

**HITL 容易被错当成"多轮会话的附赠功能",其实不是。** `respond` / `respondAll` 能工作,靠的是 T1(专门产出 `input.requested` 事件——不是随便什么事件都行)和 T2(resume——`respond` 本质是拿着用户的选择再发一轮,得靠同一条 session 续上)同时具备,再加 adapter 自己要能识别"agent 正等着人"并把 `status` 置成 `"waiting"`。三者缺一,`requireInputRequest` 要么读不到待处理请求,要么 `respond` 之后接不上下一轮。

T0/T1 是"接得上"的门槛——不做 T1,`toolObservability` 相关断言在类型层面就拿不到方法,不会跑起来才报错,写 eval 时一眼就能看出这个 agent 还没接够。T2、HITL、T3 都是"要更细信号"时再加的增量,晚做不影响先跑起来的 eval。

两种 kind(remote / sandbox)都**不动核心一行**。这是设计承重墙,见 [Vision](../vision.md)。

## 相关阅读

- [Observability](../observability.md) —— transcript → 标准事件流的归一化、o11y、用量。
- [Scoring](../scoring.md) —— 这套事件流之上的全部断言。
- [Sandbox](../sandbox.md) —— 沙箱接口与后端。
- [Coding Agent Skills / Plugins DX](coding-agent-skills-plugins.md) —— Claude Code / Codex / bub 如何安装本地 skill、repo skill 与 plugin,并组织 A/B 实验。
- [Vision](../vision.md) —— 为什么名字只能用于路由、为什么没有通用协议。
- [agent-eval 参考:它是怎么做适配的](ref/agent-eval.md) —— 学习记录,不是 fasteval 的实现。
