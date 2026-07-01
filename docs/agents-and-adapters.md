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
  workspace?: boolean;           // 在文件系统上工作 → t.sandbox(工作区断言 + diff + 句柄)
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
  readonly events: StreamEvent[];  // ★ 标准事件流 —— adapter 的核心产物,所有断言查它
  readonly data?: unknown;         // 结构化输出(供 outputEquals / outputMatches)
  readonly status: "completed" | "failed" | "waiting"; // waiting = 停在 HITL 输入上(parked)
  readonly usage?: Usage;          // token 用量(见 Observability)
  // message / toolCalls 不必手填:都从 events 派生,作为便利字段读
}
```

`send` 是**统一动词**,`Turn.events` 是**统一产物**。区别只在 `send` 内部怎么把原始返回变成 `events` —— 这就是 adapter 的核心难点。

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

## 两种 agent,同一套契约

### remote agent(评你自己的 agent / 函数 / 服务)

进程内最快零网络;远程就是 `send` 里发个 fetch。两者都是 `defineAgent`,差别只在 `send` 内部:

```typescript
// agents/my-agent.ts —— 进程内
import { defineAgent } from "fasteval";
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
| 起沙箱 + 上传 workspace + `git` 基线 | ✅ 共享 | — | — |
| 装 CLI | ✗ | `npm i -g @anthropic-ai/claude-code` | `npm i -g @openai/codex` |
| 鉴权 | ✗ | env `ANTHROPIC_API_KEY` | `codex login --with-api-key` + profile |
| 拼调用 + 丢 prompt | ✗ | `claude --print [--model <m>] --dangerously-skip-permissions <prompt>` | `codex exec --profile default --json <prompt>` |
| 模型/参数 | ✗ | CLI flag `--model`(来自 `ctx.model`) | 写 `~/.codex/default.config.toml`(同) |
| 读 transcript → 解析成 events | ✗ | `~/.claude/projects/.../{session}.jsonl` 最新一个 | `--json` stdout 即 JSONL |
| 归一化 events → diff → 验证 | ✅ 共享 | — | — |

"共享"的部分由 fasteval 提供成可复用工具(下文 [shared](#shared沙箱型-adapter-的共享工具)),所以**每个沙箱 adapter 真正要写的,就是中间那 5 行差异 + 一个 transcript 解析器**。

```typescript
// agents/claude-code.ts(内置;接 bub 照抄此形状)
import { defineSandboxAgent, shared, requireEnv } from "fasteval";

// 本地配:这个 agent 怎么连它自己 —— 鉴权在这里读;注意「没有 model」(留空,实验决定)
const auth = () => ({ ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") });

export default defineSandboxAgent({
  name: "claude-code",
  // 运行器已用 shared 把沙箱备好(上传 / git 基线),通过 ctx.sandbox 传入
  async send(input, ctx) {
    const sb = ctx.sandbox!;
    await sb.runCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"]);

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
| **feature flags**(webResearch、注入哪个 skill、effort…) | **实验决定** | `ctx.flags.*` —— `send`、`hooks.sandbox.setup`、eval 的 `t.flags` 都能读 |
| runs / earlyExit / evals / sandbox / budget / hooks | **实验决定** | 运行器据此调度;`hooks.sandbox.setup(sb, ctx)` 也拿得到 `ctx.flags`,详见 [Lifecycle](lifecycle.md) |

一句话:**agent 只配「怎么连我自己」,不配「跑哪个模型、开哪些开关」**;后者全留给 [experiment](experiments.md),经 `ctx`(eval 里是 `t`)透传。这样同一个 agent 能被不同实验以不同 model / flags 复用,不必改 agent。

## 能力位决定 `t` 的形状

`test(t)` 收到的 `t` 是**按 agent 能力组装**的(见 [Architecture](architecture.md#t-上下文能力决定形状)):

- 任意 agent → `t.send` / `t.check` / `t.require` / `t.judge` / `t.log` / `t.skip`。
- `conversation` → `t.send` 可多次、`t.reply`、`t.newSession`。
- `toolObservability` → `t.calledTool` / `t.toolOrder` / `t.usedNoTools` / `t.calledSubagent` / `t.event`…。
- `workspace`(沙箱型)→ `t.sandbox`(工作区断言 + `t.sandbox.diff` + 句柄 + `t.sandbox.judge`)/ `t.transcript` / 跑 `EVAL.ts`。

作者写 `t.calledTool` 时若 agent 没声明 `toolObservability`,在类型层面就拿不到这个方法,不会跑起来才报错。

### `ctx`(agent 侧)与 `t`(eval 侧):同一份东西,两个名字

`send` / `hooks.sandbox.setup` 收到的叫 `ctx`,`test` 收到的叫 `t`。它们不是两套数据:**`t` 是运行器在 `ctx` 之上为 eval 作者搭的高层视图** —— `t.send(...)` 内部就是拿着 `ctx` 去调 `agent.send(input, ctx)`。

| 概念 | `ctx`(agent:`send` / `hooks.sandbox.setup`) | `t`(eval:`test`) | 关系 |
|---|---|---|---|
| 实验 flags | `ctx.flags` | `t.flags` | **同一份**(experiment 给) |
| 模型 | `ctx.model`(用来拼 `--model`) | `t.model`(只读,知道在测谁) | 同一份 |
| 取消信号 | `ctx.signal` | `t.signal` | 同一份 |
| 日志 | `ctx.log()` | `t.log()` | 同一个 |
| 会话 | `ctx.session`(`id`/`isNew`,用来 resume) | `t.newSession()`(发起新会话) | `t` 发起 → 运行器置 `isNew` → `ctx` 执行 |
| 沙箱 | `ctx.sandbox`(底层 `Sandbox` 句柄) | `t.sandbox`(句柄 + 工作区断言 + `t.sandbox.diff`)/`t.transcript`(高层视图) | `t.sandbox.*` 是 `ctx.sandbox` 的高层封装 |
| 一轮结果 | `send` 返回的 `Turn`(`events` 为核心) | `t.send()` 的返回 / `t.reply` / `turn.outputEquals` | core 把 `Turn` 转交给 eval |
| 鉴权 / CLI 细节 | agent 本地(**不在 ctx**) | — | 谁都不暴露给对方 |
| 断言 / judge / transcript 派生 | — | `t.check`/`t.calledTool`/`t.judge`/`t.transcript`/`t.maxTokens`… | 只在 eval 侧 |

口诀:**`ctx` 是「驱动 AI」的低层上下文(agent 用),`t` 是「写断言」的高层上下文(作者用);共享 experiment 透传的那几样,其余各管一摊。**

## Agent × Sandbox 正交

```text
experiment.agent    选「连哪个被测对象」(自实现的 adapter)
--sandbox <backend> 选「沙箱型 agent 在哪跑」(docker / vercel / 三方)
```

任意沙箱型 agent × 任意 sandbox 后端自由组合:`claude-code` 可跑 docker 也可跑 vercel;同一个 docker 沙箱可跑 `claude-code` 也可跑 `bub`。运行器按 experiment / `--sandbox` 备好 `Sandbox` 交给 `ctx.sandbox`,二者只通过 `Sandbox` 接口交互。remote agent 忽略 sandbox。详见 [Sandbox](sandbox.md)。

## shared:沙箱型 adapter 的共享工具

跨所有沙箱 adapter 复用、不属于任何单个 agent 的逻辑,由 fasteval 提供(对应 agent-eval 的 `shared.ts`),保证所有 coding agent 的"上传 / 基线 / 采 diff / 验证"严格一致:

- **`prepareWorkspace(sandbox, fixture)`** —— 上传 workspace files(藏起 `EVAL.ts` 等 test files,防作弊),`git init && commit` 打基线。
- **`captureGeneratedFiles(sandbox)`** —— `git diff HEAD` 得到 `{ generated, deleted }`。
- **`runValidation(sandbox, scripts, mode)`** —— 上传 test files,跑 `EVAL.ts`(Vitest)+ npm scripts。
- **`injectO11yContext(sandbox, events)`** —— 由标准事件流派生 o11y,写 `__fasteval__/results.json`,供 `EVAL.ts` 断言行为。
- **`captureLatestJsonl(sandbox, dir)`** / transcript 定位辅助。

运行器对沙箱型 agent 的编排:`prepareWorkspace` → `agent.send`(adapter 在沙箱里跑 + 解析成 events)→ `runValidation` → `captureGeneratedFiles` → `sandbox.stop`。adapter 只填中间那一段。

## 注册与选择

```typescript
// fasteval.config.ts
import { defineConfig } from "fasteval";
import myAgent from "./agents/my-agent.js";
import supportBot from "./agents/support-bot.js";

export default defineConfig({
  agents: [myAgent, supportBot],     // 你的自实现 agent
  // 在 experiments/ 里引用要跑的 agent
});
```

内置 coding-agent(`claude-code` / `codex` / `bub` …)从 `fasteval` 导出,在 experiment 文件里引用。要换 agent 或 model,复制一个 experiment 文件改配置。

## 接一个新 agent 要写什么

- **remote agent** —— 实现 `defineAgent` 的 `send`,在里面把你的响应映射成标准 `events`,声明能力。就这些。
- **sandbox agent** —— 实现 `defineSandboxAgent` 的 5 个差异点(装 CLI、鉴权、拼调用、模型、读 transcript),复用 shared;再加一个 [transcript 解析器](observability.md)(`o11y/parsers/<name>.ts`)把原始 JSONL 解析成标准 `StreamEvent[]`。

两种都**不动核心一行**。这是设计承重墙,见 [Vision](vision.md)。

## 相关阅读

- [Observability](observability.md) —— transcript → 标准事件流的归一化、o11y、用量。
- [Scoring](scoring.md) —— 这套事件流之上的全部断言。
- [Sandbox](sandbox.md) —— 沙箱接口与后端。
- [Vision](vision.md) —— 为什么名字只能用于路由、为什么没有通用协议。
