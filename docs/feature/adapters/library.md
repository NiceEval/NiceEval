# Adapters —— 库用法

Adapter 作者从 `niceeval/adapter` 导入构造器、转换器与流式组合件。
这一页从可运行代码开始；内部数据结构和不变量见 [Architecture](architecture.md)。

## Direct Agent

被测对象通过 HTTP、RPC 或其它进程外协议提供服务时，使用 `defineAgent`：

```ts
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const response = await fetch(`${process.env.AGENT_URL}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
      signal: ctx.signal,
    });
    const body = await response.json();
    if (body.sessionId) ctx.session.capture(body.sessionId);
    return { status: toTurnStatus(body), data: body.output, events: toStreamEvents(body) };
  },
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
  async send(input, ctx) {
    ctx.progress({ message: "waiting for upstream model" });
    const response = await callAgent(input, { signal: ctx.signal });

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
  },
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

内置 `uiMessageStreamAgent()` 收到 error 帧并以 `[DONE]` 结束、却没有 assistant 消息时，send 仍然失败并原样保留非空白的 `errorText`。errorText 为空白、或没有 error 帧且无法形成 assistant 消息时，使用说明缺失 assistant 的非空英语诊断；两者都不伪造成功 Turn。协议终点与审批行为见 [AI SDK](sdk/ai-sdk/README.md)。

## Sandbox Agent

被测对象是在隔离 Sandbox 中运行的 coding-agent CLI 时，使用 `defineSandboxAgent`。
CLI 身份写在必填 `ensure` 中，由 Runner 负责 探测、配对 Installer、安装与复检。
`setup` 只写鉴权、运行时配置和扩展；每轮执行与 transcript 采集放在 `send`：

```ts
import { completeEvidenceCoverage, defineSandboxAgent, makeSendFailure } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

export default defineSandboxAgent({
  name: "my-coding-agent",
  evidenceCoverage: completeEvidenceCoverage,
  ensure: {
    identity: { agent: "my-coding-agent", version: "1.4.2" },
    probe: shell('test "$(my-agent --version)" = "1.4.2"'),
  },
  async setup(sandbox, ctx) {
    await sandbox.writeText(".my-agent/config.json", credentialsFrom(ctx));
  },
  async send(input, ctx) {
    ctx.progress({ message: "running agent CLI" });
    const result = await ctx.sandbox.runCommand("my-agent", ["--json", input.text]);
    const parsed = parseTranscript(result.stdout);
    if (result.exitCode !== 0 || !parsed.turn) {
      throw makeSendFailure({
        acceptance: parsed.acceptance ?? "unknown",
        message: parsed.error ?? `my-agent exited ${result.exitCode}`,
        events: parsed.events,
        process: result,
      });
    }
    return parsed.turn;
  },
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

`createCodexThreadEventStream()` 保留 Codex 非致命 `item.completed` error 的原始消息，但不因此设置 `failed`；后续完成的 Turn 仍可成功，工具与 usage 照常保留。`turn.failed` 或顶层不可恢复 `error` 会设置 `failed`，后续 `turn.completed` 不会清除该标志。顶层 error 即使消息为空也标记失败；SDK iterator 或进程异常仍由 Adapter 抛出 `SendFailure`，转换器的标志不能替代执行失败通道。

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

## 保存 Attempt 附件

自定义 Adapter 的 `create(ctx)` 可以用 `ctx.attach` 保存文本、图片或其它 bytes：

```ts
const receipt = await ctx.attach({
  name: "response.json",
  mediaType: "application/json",
  body: JSON.stringify(response),
});
```

输入 `body` 为 `Uint8Array | string`；字符串按 UTF-8 编码。`name` 是显示标签，允许同名，不用作磁盘路径，
也不替换同名附件。框架为每次成功接管分配独立 `artifactId`，返回
`{ artifactId, name, mediaType, byteLength, sha256 }`。

调用在返回 Promise 前复制 bytes；调用方随后修改原数组不会改写已接管内容。Promise 成功只证明接管，
持久性由 Attempt publication 提供。附件 bytes 随 Record 保存，搬走 Record 后无需保留源文件或应用工作目录。

每个 Attempt 最多接管 4000 件、累计 256 MiB，每件最多 64 MiB，边界值可用。非法输入、超限和关闭后的调用明确拒绝；
采集失败不会丢弃此前已接管的内容。关闭前发生的失败保留为 Attempt 执行错误，collection 标为 partial，即使作者捕获了拒绝。

Attempt 取消不立刻关闭附件入口。已登记 cleanup 在独立 cleanup 时限内仍可附加诊断材料；cleanup 完成或截止时关闭入口并封存快照。
关闭后的迟到调用不能修改封存事实。读取使用 [Inspection 的附件 operation](../inspection/architecture.md#附件分块读取)。

## 上报外部调用用量

普通 Adapter 从 `create(ctx)` 取得 `ctx.recordUsage`，把外部系统观测到的物理调用上报给框架。
接口不要求 Agent、消息、游戏状态或特定模型 SDK：

```ts
ctx.recordUsage({
  callId: "request-42",
  provider: null,
  model: null,
  status: "unknown",
  inputTokens: null,
  inputTotalTokens: 120,
  outputTokens: 8,
});
```

`callId` 在一个 Attempt 内标识物理调用；重试使用新 ID，`retryOf` 可引用此前已登记的 ID。
相同规范化快照重复上报不增加用量；同 ID 的冲突快照明确失败。每个 Attempt 最多保存 4000 次调用的快照。
这是终态快照入口：先收尾外部观测，再上报；只有 started 而无 terminal 的调用标为 `unknown`，不推断成功。
`status` 接受 `succeeded | failed | cancelled | unknown`；供应商和模型未知时保留 `null`，不从通道名称推断。

`inputTokens` 排除缓存读取与写入；`inputTotalTokens` 是独立观测到的含缓存输入总量。
可选 `cacheReadTokens`、`cacheWriteTokens` 和 `inputTotalTokens` 省略时为 `null`，不得为了补全而填零。
所有已知计数必须是非负安全整数；明确的零保留为已知零。已知分项之和不得超过已知总量，分项全部已知时必须相等。
总量与分项独立保存，不重复相加，也不根据不完整分项补算总量。

`attempt.usage` 返回 `source: "adapter"`、`coverage: "recorded-calls"`、调用快照和各计数的已知小计。
未知值保留，部分小计标为 partial；已上报快照完整不代表包含外部系统的全部调用。单次最多返回前 128 条调用，
`callsTruncated` 与 `omittedCallCount` 明示截断；聚合仍包含已封存的全部调用。框架不猜测价格。

用量入口与附件入口共用 Attempt 的有界 cleanup 生命周期。取消后 cleanup 未结束时仍可上报；
关闭后的调用拒绝且不能改写已封存事实。关闭前的采集错误即使被作者捕获，也保留为最终执行错误。
