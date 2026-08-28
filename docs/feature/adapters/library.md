# Adapters —— 库用法

Adapter 作者从 `niceeval/adapter` 导入构造器、转换器与流式组合件。
这一页从可运行代码开始；内部数据结构和不变量见 [Architecture](architecture.md)。

## Direct Agent

被测对象通过 HTTP、RPC 或其它进程外协议提供服务时，使用 `defineAgent`：

```ts
import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  send: Effect.fn("supportBot.send")((input, ctx) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${process.env.AGENT_URL}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
          signal: ctx.signal,
        });
        const body = await response.json();
        if (body.sessionId) ctx.session.capture(body.sessionId);
        return { status: toTurnStatus(body), data: body.output, events: toStreamEvents(body) };
      },
      catch: (cause) => cause,
    })),
});
```

URL、鉴权和请求体是 Adapter 的私有协议。
model、reasoning effort 与实验 flags 来自 `ctx`，由 experiment 决定。

## 向运行反馈进度与诊断

`setup`、`send`、`teardown` 中的 `ctx` 都提供 `progress` 与 `diagnostic`,runner 会把它们绑定到当前 `agent.setup`、`agent.run` 或 `agent.teardown`:

```ts
export default defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  send: Effect.fn("supportBot.send")((input, ctx) => Effect.gen(function* () {
    ctx.progress({ message: "waiting for upstream model" });
    const response = yield* Effect.tryPromise({
      try: () => callAgent(input, { signal: ctx.signal }),
      catch: (cause) => cause,
    });

    if (response.eventsIncomplete) {
      ctx.diagnostic({
        code: "incomplete-event-stream",
        level: "warning",
        message: "Upstream response omitted tool result events",
        data: { requestId: response.requestId },
        dedupeKey: `incomplete-event-stream:${response.requestId}`,
      });
    }
    return toTurn(response);
  })),
});
```

`progress` 是可覆写的短期 activity,适合 turn、tool 或安装进度;不要每个 token/delta 都调用。
`diagnostic` 是永久 warning/error,适合协议降级、数据不完整和 cleanup 问题。
两者都不能指定 phase、输出流或 ANSI,也不会改变 `Turn.status`/verdict。
无法继续时抛异常;被测 agent 正常返回失败时通过 `Turn.status: "failed"` 表达。

`ctx.log(message)` 是显式 timeout breadcrumb，不是 `progress` 的别名。
它也会更新 active 行，但内容可能在 attempt timeout 时进入 error；只应写入适合长期诊断的阶段信息。
user message 与 tool input 等短命内容只能走 `progress`。

不要在 run 期间直接调用 `console.log/error` 或写 `process.stdout/stderr`:这会打散 Human dashboard,也会破坏非交互输出(非 TTY 人读文本与 `--json`)的单一有序流。
反馈怎样被两种输出形态消费见 [Experiments · 生命周期代码怎样向这次运行反馈](../experiments/library.md#生命周期代码怎样向这次运行反馈)。

## Sandbox Agent

被测对象是在隔离 Sandbox 中运行的 coding-agent CLI 时，使用 `defineSandboxAgent`。
CLI 身份写在必填 `ensure` 中，由 Runner 负责 探测、配对 Installer、安装与复检。
`setup` 只写鉴权、运行时配置和扩展；每轮执行与 transcript 采集放在 `send`：

```ts
import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent, makeSendFailure } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export default defineSandboxAgent({
  name: "my-coding-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "my-coding-agent", version: "1.4.2" },
    probe: shell('test "$(my-agent --version)" = "1.4.2"'),
  },
  setup: Effect.fn("myCodingAgent.setup")((sandbox, ctx) =>
    Effect.tryPromise({
      try: () => sandbox.writeText(".my-agent/config.json", credentialsFrom(ctx)),
      catch: (cause) => cause,
    })),
  send: Effect.fn("myCodingAgent.send")((input, ctx) => Effect.gen(function* () {
    ctx.progress({ message: "running agent CLI" });
    const result = yield* Effect.tryPromise({
      try: () => ctx.sandbox.runCommand("my-agent", ["--json", input.text], { signal: ctx.signal }),
      catch: (cause) => cause,
    });
    const parsed = parseTranscript(result.stdout);
    if (result.exitCode !== 0 || !parsed.turn) {
      return yield* Effect.fail(makeSendFailure({
        acceptance: parsed.acceptance ?? "unknown",
        message: parsed.error ?? `my-agent exited ${result.exitCode}`,
        events: parsed.events,
        process: result,
      }));
    }
    return parsed.turn;
  })),
});
```

第三方 Adapter 若不随包提供匹配 identity 的 Installer，探测 未命中会明确 `errored`；它不能把安装偷回 `setup`。

内置 coding agents 见 [SDK 与 Agent 索引](sdk/README.md)，扩展配置见 [配置 Coding Agent 扩展](library/coding-agent-extensions.md)。

## 递进实现

| 增量 | Adapter 义务 | 解锁的行为 |
|---|---|---|
| 收发消息 | 返回可信 Turn；执行异常 reject `SendFailure` | 单轮发送、输出断言 |
| 标准事件流 | 完整映射消息与 operation，保持顺序和 operation ID | 工具、消息与事件断言 |
| 多轮会话 | 使用 typed session slot 或 `id` / `capture()` | 多轮与 `newSession()` |
| HITL | 返回 `waiting`、`input.requested`，按 request ID 恢复 | `t.check(turn.status, equals("waiting"))`、`requireInputRequest`、`respond` |
| tracing | 配置 exporter 与 span mapper | 结果 trace 和 view 瀑布图 |

这条递进路径描述一个 Adapter 实现了多少行为，与 Tier 1/2/3 描述的应用侵入程度是两条正交坐标。

## 会话存取器

| 存取器 | 后端形态 |
|---|---|
| `ctx.session.get(slot)` / `set(slot, value)` | 无状态服务；用 adapter 私有 typed slot 保存完整消息历史 |
| `ctx.session.id` / `capture(id)` | 服务端保存历史；请求携带 session/thread ID |
| `ctx.session.take(slot)` | HITL 回答轮一次消费 adapter 私有 slot 中的暂停现场 |

会话状态只保存在 `ctx.session`。
模块级 Map 会让并发 attempt 或 `t.newSession()` 之间串线。

## 按任务继续

| 现在要做什么 | 阅读 |
|---|---|
| 从最小 `send` 开始逐步补能力 | [编写 Adapter](library/writing-an-adapter.md) |
| 连接 HTTP / RPC / SDK 服务 | [Direct Agent](library/direct-agent.md) |
| 在 Sandbox 中运行 coding-agent CLI | [Sandbox Agent](library/sandbox-agent.md) |
| 消费 SSE、SDK frames 或 delta | [流式协议与共享工具](library/streaming.md) |
| 实现多轮和审批恢复 | [使用会话与 HITL](library/sessions-and-hitl.md) |
| 安装 Skills、MCP 和原生 Plugins | [配置 Coding Agent 扩展](library/coding-agent-extensions.md) |

事件数据结构、会话状态模型和负断言完整性属于实现不变量，分别见 [标准事件模型](architecture/events.md)、[会话状态模型](architecture/session-state.md) 和 [断言证据](architecture/evidence.md)。

## SDK 与协议转换器

不同 SDK 不在本页堆叠。
每个 SDK 使用独立小文件说明其入口、原始事件、会话、HITL、usage 和完整性边界：

- [AI SDK](sdk/ai-sdk/README.md)
- [Claude Agent SDK](sdk/claude-agent-sdk/README.md)
- [Codex SDK](sdk/codex-sdk/README.md)
- [pi-agent-core](sdk/pi-agent-core/README.md)
- [LangGraph](sdk/langgraph/README.md)
- [OpenCode](sdk/opencode/README.md)
- [Hermes Agent](sdk/hermes/README.md)
- [OpenClaw](sdk/openclaw/README.md)
