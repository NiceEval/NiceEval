# Adapters —— 库用法

Adapter 作者从 `niceeval/adapter` 导入构造器、转换器与流式组合件。
这一页从可运行代码开始；内部数据结构和不变量见 [Architecture](architecture.md)。

## Attempt 取消与资源释放预算

普通应用以 Attempt 为运行边界，Session 与 Turn 仅属于 Agent 应用协议。
应用可以自行提供 start、waitUntil 与 finalize；框架不生成隐式轮次。
Agent 的 send 等待一次应用交互完成，即时应用可以等待业务事件或状态条件成立。
两者都在等待事实后继续评估；应用决定交互与观察边界，通用 Match 不订阅事件，也不承担等待循环。

`defineAdapter` 与 `AdapterContract.implement` 的 `cleanupTimeoutMs` 声明该实现的整个 cleanup 时段。
默认 30000 ms，允许整数 1–300000 ms。预算由实现固定，不接受 Experiment、Config 或 CLI 替换。
它进入公开 Adapter identity 和配置指纹；不同预算不能默默复用相同运行配置。

`AdapterCreateContext.signal` 为 `AttemptSignal`，未取消时 reason 为 undefined。
取消后 reason 是冻结的判别联合：timeout 包含 timeoutMs、source 和 Unix 毫秒 deadlineAt；cancelled 表示外部或 Host Effect 取消。
source 使用执行时限的 flag、experiment、eval、config 四层词表，不通过异常文案猜测。

`onCleanup` 的冻结 context 提供独立 signal、timeoutMs 与 deadlineAt。
预算从实际进入 cleanup 开始，全部回调、晚到注册、handoff 和归档共享同一截止，不逐项重新计时。
预算到期先关闭所有采集入口，再通知取消。应用自建 signal 不能延长框架时段。

正常路径先停止输入、排空并封存事实，再执行最终 check/judge。
执行取消时先关闭断言登记，cleanup 只允许上报用量、附件、trace 和诊断。
abort 不证明物理请求已结束，真实完成必须来自应用回执。
游戏测量截止与排空尾部分开，cleanup 不延长已固定的业务时间。

普通 cleanup 回调抛错保留 warning 并继续其它释放。总时段超时产生 adapter-cleanup-timeout 执行错误。
需要排空成功才能评分时，作者在正常 test 中等待 finalize。第二次 OS signal 仍可强制退出。

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

## 保存通用执行轨迹

Adapter 的 `create(ctx)` 通过 `ctx.recordTrace(snapshot)` 接纳已封存的领域事件快照。会话 Agent 是执行轨迹的一种 producer；
普通 Adapter 保留自己的事件类型、主体、时间和关系，不需要构造 Turn 或 tool call。
它返回 `Promise<ExecutionTraceReceipt>`；成功只证明接纳，持久性由同一 Attempt publication 提供。

输入的 `traceId` 是 Attempt 内快照幂等键。事件 `key` 是该快照内的导入关联键，可以由导入器分配；
`source.eventId` 只保存上游真实提供的 ID。框架接纳后分配稳定 `eventId`，receipt 返回两者的映射。
缺少原生 ID 时省略该字段，不用导入序号冒充原生事实。

```ts
type TraceJson = null | boolean | number | string
  | readonly TraceJson[] | { readonly [key: string]: TraceJson };

interface ExecutionTraceInput {
  readonly traceId: string;
  readonly schema: { readonly id: string };
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly { readonly code: string; readonly message: string }[];
  };
  readonly scopes: readonly {
    readonly scopeId: string;
    readonly label: string;
    readonly boundary: TraceJson;
  }[];
  readonly events: readonly {
    readonly key: string;
    readonly type: string;
    readonly source: { readonly id: string; readonly eventId?: string; readonly sequence?: number };
    readonly actor?: { readonly id: string; readonly label?: string };
    readonly time?: { readonly clockId: string; readonly value: number; readonly unit: string };
    readonly summary: string;
    readonly payload?: TraceJson;
    readonly links?: readonly (
      | { readonly relation: string; readonly targetKey: string }
      | { readonly relation: string; readonly unresolved: { readonly sourceEventId: string; readonly reason: string } }
    )[];
    readonly evidence?: readonly {
      readonly key: string;
      readonly label: string;
      readonly artifactId: string;
      readonly pointer: string;
    }[];
    readonly scopeMemberships?: readonly {
      readonly scopeId: string;
      readonly state: "included" | "excluded" | "unknown";
    }[];
  }[];
}

interface ExecutionTraceReceipt {
  readonly state: "accepted";
  readonly traceId: string;
  readonly events: readonly {
    readonly key: string;
    readonly eventId: string;
    readonly evidence: readonly { readonly key: string; readonly evidenceId: string }[];
  }[];
}
```

`schema.id` 和事件 `type` 标识领域格式，Adapter 不提交 `schema.revision`。NiceEval 验证封闭 envelope 与有限 plain JSON，
领域负载校验由 Adapter 的 parser 负责；未知领域仍可用通用展示读取，无需注册每种事件或运行作者代码。

框架自行管理 Record 格式版本。历史 Record 中已有的领域 `schema.revision` 原样只读保留；缺失时不补值，新写入只包含 `id`。
升级后的输入校验拒绝旧调用中多余的 `revision`，但不影响读取历史 Record。旧包不保证能读取新包写入的轨迹；
旧 reader 的完整性错误不能据此证明新文件损坏，降级包版本不构成完整回滚方案。

泛型事件声明应保留 `type` 与 `payload` 的判别联合。JSON 不接受非有限数、循环、accessor、class 或隐式 `toJSON`。

展示顺序固定为接纳快照的事件顺序，不构成因果证明。`source.sequence` 是非负安全整数，不要求连续或全局唯一。
时间属于同一 trace 内的 `clockId`，同一 clock 的 unit 必须一致，不能跨 trace 相减或排列成物理因果。
`links` 的已定位目标必须存在于同一快照；`causes` 关系不能成环。其它关系名开放，缺失目标显式保留 unresolved。

`scopes` 保存 Adapter 声明的测量边界，membership 引用已声明 scope，缺失 membership 为 unknown。
边界 JSON 不参与 NiceEval 的评分计算；测量区间外排空事件可以保存为 excluded，缺少测量边界不补造有效评分区间。
执行取消与采集完整度独立：取消仍可完整采集，成功也可只有 partial 证据。

`evidence` 引用同一 Attempt 已由 `ctx.attach` 接纳的 JSON 附件，`pointer` 按 RFC 6901 定位精确值。
Adapter 负责将领域 request reference 映射为明确的 link 或 evidence，框架不扫描负载猜关系。
接纳时验证附件与 pointer，并固定附件及目标内容摘要；发布和读取再次验证同 owner 的内容闭合。
大请求保留在附件中，事件只保存精确引用。缺失 pointer 拒绝整份快照，不回退为整件附件。

同 `traceId` 的规范化快照完全相同则返回原 receipt；对象键顺序不影响比较，事件数组顺序参与比较。
冲突、非法输入或预算超限拒绝整份输入，保留此前接纳的快照，并登记采集失败。不得静默截取为合法前缀。
complete 的 limitations 必须为空，partial 必须有原因；从未提交不等于 complete-empty。

每个 Attempt 最多 32 份快照、100,000 个事件、64 MiB 规范化输入。每事件 payload 最多 16 KiB，summary 最多
512 UTF-8 bytes，links 最多 32 项，evidence 与 membership 各最多 8 项。标识最多 256 UTF-8 bytes，JSON 深度最多 32。
同 trace 的 key、scopeId 唯一；同事件的 evidence key 与 membership 不重复。

一次接纳或读取最多处理 256 MiB 原始附件内容与 128 MiB 规范化证据目标，相同附件及 pointer 复用校验结果。
超过预算明确失败，不返回未经验证的预览。作为 JSON pointer 证据的单件附件最多 64 MiB，读取前检查大小。

接纳在返回 Promise 前完成验证与复制，不绑定已取消的执行 signal。Adapter 可在独立 cleanup 接纳时段结束前提交
已验证的 partial；正常和失败路径应共享一次 finish。接纳时段结束后的调用拒绝且不改变封存事实。
持久内容校验或 storage 失败阻止 Attempt publication，不能发布缺少声明证据的成功快照。

### 事件展示块

事件可以带可选的 `display`：一组人读展示块，随事件一起封存。`show --execution` 与 View 按块呈现，读取时不运行 Adapter 代码。
没有 `display` 的事件以 envelope、`summary` 与 payload JSON 呈现。

```ts
type ExecutionDisplayBlock =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant" | "system" | "other";
      readonly speaker?: string;
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: string | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: string }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string };

interface ExecutionTraceEvent {
  // key、type、source、actor、time、summary、payload、links、evidence、scopeMemberships
  readonly display?: readonly ExecutionDisplayBlock[];
}
```

- `display` 省略表示没有展示块；空数组非法。块按数组顺序呈现，顺序不证明因果。
- 文本原样保存，不解释 Markdown、HTML 或 ANSI；只保留 `\t` 与 `\n` 两种控制字符。
- `message.role` 只决定人读样式，不进入 conversation、usage 或 Judge 材料。`speaker` 省略时显示 role 的英文标签。
- `fields.value` 只接受有限标量，原样显示，不格式化单位或小数位。`code.language` 只是显示提示。
- `image.artifactId` 必须是同一 Attempt 已由 `ctx.attach` 接纳、`mediaType` 为 `image/png`、`image/jpeg`、`image/webp` 或 `image/gif` 的附件。
  接纳时固定附件的 `mediaType`、`byteLength` 与 `sha256`；媒体类型是标签，不证明 bytes 可解码。`alt` 必填。

展示块与 `payload` 相互独立：payload 是领域事实，展示块是同一事实的人读形式。NiceEval 不校验二者一致，也不从 payload 生成展示块。
展示块与 payload 一样只能放已脱敏、可公开的内容。

| 项 | 上限 |
|---|---|
| 每事件块数 | 4 |
| 每事件展示总量（规范化 UTF-8） | 8 KiB，计入每 Attempt 64 MiB 规范化输入 |
| `fields` 项数 | 16 |
| `label`、`speaker`、`language` | 128 UTF-8 bytes，不含换行 |
| `alt` | 512 UTF-8 bytes，不含换行 |

字符串不能含除 `\t`、`\n` 外的 C0/C1 控制字符，也不能含 U+2028、U+2029 或双向格式控制字符。
违反任一规则时整份快照被拒绝，code 为 `execution-display-invalid`，并指出违规的 `events[i].display[j]` 与字段名。
展示块参与同 `traceId` 的幂等比较；它不进入执行资格身份，修改展示内容不触发重跑。

#### 轨迹保存在外部系统

应用自己保存完整轨迹时，提交一个指向外部系统的事件，并把快照标为 `partial`：

```ts
await ctx.recordTrace({
  traceId: "rpg",
  schema: { id: "example.rpg/v1" },
  collection: {
    state: "partial",
    limitations: [{ code: "external-trace", message: "Full trace is stored by the RPG server." }],
  },
  scopes: [],
  events: [{
    key: "run",
    type: "rpg.run",
    source: { id: "rpg-server", eventId: "run_8f2c" },
    summary: "Full trace stored by the RPG server: run_8f2c",
    payload: { runId: "run_8f2c" },
    display: [
      { kind: "text", text: "The full trace is stored by the RPG server. Query it with:" },
      { kind: "code", language: "shell", text: "rpg-cli trace show run_8f2c" },
    ],
  }],
});
```

命令是不可信的应用文本。NiceEval 不执行、不打开，也不验证外部系统里的数据是否存在。
外部 ID 拼进命令前，Adapter 负责限定字符集或按目标 shell 引用；命令里不能放 token、密码或签名 URL。

## 保存 Attempt 附件

自定义 Adapter 的 `create(ctx)` 可以用 `ctx.attach` 保存文本、图片或其它 bytes：

```ts
const receipt = await ctx.attach({
  name: "response.json",
  mediaType: "application/json",
  body: JSON.stringify(response),
});
```

公开输入与回执形状如下：

```ts
interface AdapterAttachmentInput {
  readonly name: string;
  readonly mediaType: string;
  readonly body: Uint8Array | string | {
    readonly stream: (signal: AbortSignal) => AsyncIterable<Uint8Array>;
  };
  readonly signal?: AbortSignal;
}

interface AdapterAttachmentReceipt {
  readonly artifactId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}
```

字符串按 UTF-8 编码。`name` 是显示标签，允许同名，不用作磁盘路径，也不替换同名附件。
每次成功接管分配独立 `artifactId`。`mediaType` 是内容标签；归档不做内容解码、转换或业务格式推断。

字符串和数组在返回 Promise 前复制，调用方随后修改原数组不会改写已接管内容。
流工厂只调用一次；框架把取消信号传给字节 producer，每次只拉取一块，复制并写完当前块才请求下一块。
每块必须是至多 1 MiB 的 `Uint8Array`，字节 producer在下一次拉取前不得修改它。
文件可由调用方使用 `stream: signal => createReadStream(path, { signal })` 提供，路径不进入附件事实。

流的 Promise 成功前，框架已完成原始 bytes 的独立归档并关闭自己的写入文件。
字节 producer必须提供有限内容；调用方在读取期间保持源文件稳定，收到成功回执后可立即修改或删除源文件。
`byteLength` 与 `sha256` 来自实际接管的原始 bytes，不来自调用方声明或路径。
Promise 成功只证明接管，持久性由 Attempt publication 提供；本地暂存不是远端上传。
附件随 Record 保存，搬走 Record 后无需保留源文件或应用工作目录。

每个 Attempt 最多接管 4000 件。字符串和数组单件最多 64 MiB，累计最多 256 MiB。
流单件最多 1 GiB；所有字节 producer连同正在写入的内容累计最多 2 GiB。
每个 Attempt 最多同时归档 4 个流，额外调用明确拒绝，不启动字节 producer。边界值可用。
暂存目录位于 Record 的项目存储目录，使用私有目录与文件权限；并发磁盘预算是单 Attempt 上限乘以执行并发数。
分块和并发上限限制框架持有的内存与文件句柄；字节 producer自己的预取、缓存和外部资源由字节 producer负责。

非法输入、超限、字节 producer异常、调用方取消和关闭后的调用明确拒绝，不返回部分内容的成功回执。
失败释放该次部分归档，保留此前成功接管的附件。关闭前的失败保留为 Attempt 执行错误，collection 标为 partial，即使作者捕获了拒绝。

Attempt 取消不立刻关闭附件入口。已登记 cleanup 在独立时限内仍可附加诊断材料；cleanup 完成或截止时关闭入口并封存快照。
调用方可通过 `signal` 提前取消单次归档；流收到的信号同时受入口关闭控制。
取消或失败时框架停止拉取，发出取消信号并请求迭代器 `return()`，关闭自己的文件并删除部分归档。
字节 producer必须响应信号并释放自己的资源；不协作的 `next()` 或 `return()` 不阻塞框架关闭，也不能在迟到后改变封存结果。

已发起但未等待的归档仍进入该 Adapter 的 cleanup 总时限；到期即取消，流式归档不延长该时限。归档成功不等于发布成功；发布失败不能返回成功的持久 Record。
发布成功或失败后立即释放暂存副本，未走到发布的异常路径在 Invocation 退出时删除暂存副本。
读取使用 [Inspection 的附件 operation](../inspection/architecture.md#附件分块读取)。

## 上报外部调用用量

普通 Adapter 从 `create(ctx)` 取得 `ctx.recordUsage`，把外部系统观测到的物理调用上报给框架。
接口不要求 Agent、消息、游戏状态或特定模型 SDK：

```ts
ctx.recordUsage({
  callId: "request-42",
  provider: "typesafe-ai",
  model: "typesafe-ai/jev",
  route: { transportProvider: "vercel", endpointId: null },
  status: "succeeded",
  inputTokens: 112,
  inputTotalTokens: 120,
  outputTokens: 8,
  cost: {
    amount: "0",
    currency: "USD",
    source: { kind: "reported", id: "vercel-ai-gateway.response" },
  },
});
```

Adapter 在全部可取得的物理调用最终快照登记后，调用 `ctx.sealUsage({ state: "complete" })`。
完整空账本也需要显式声明。源只读到一部分时，登记已有调用后调用
`ctx.sealUsage({ state: "partial", reason: "source-incomplete" })`；reason 是 1–128 字符的非秘密 ASCII 标识。
标识首字符为字母或数字，其余允许字母、数字、点、下划线、冒号和连字符。
`AdapterUsageSeal` 从根包导出。未声明时费用只提供已知小计，不能据零调用或 Eval 的 Verdict 推断完整。

封存停止此 Attempt 的用量接纳；捕获开放期间重复封存、封存后上报或非法参数均使 Attempt errored，捕获错误即使被作者 catch 也保留。
已登记费用不会删除。cleanup 时段内可以补齐回执再封存，框架截止后迟到写入只拒绝，不再修改结果。
`t.usage` 是读取时的不可变快照：cleanup 阶段封存不会改善此前快照或预算断言。
需要完整预算判断时，必须先结束采集并封存，再读取用量。

`callId` 在一个 Attempt 内标识物理调用；重试使用新 ID，`retryOf` 可引用此前已登记的 ID。
相同规范化快照重复上报不增加用量；同 ID 的冲突快照明确失败。每个 Attempt 最多保存 4000 次调用的快照。
这是终态快照入口：先收尾外部观测，再上报；只有 started 而无 terminal 的调用标为 `unknown`，不推断成功。
`status` 接受 `succeeded | failed | cancelled | unknown`；供应商和模型未知时保留 `null`，不从通道名称推断。

`provider` 只保存上游可证的 serving provider。可选 `route` 分开保存 transport provider 与非秘密 endpoint identity；未知字段为 `null`。

可选 `cost` 只接受上游报告的一个有效金额，`source.kind` 固定为 `reported`。`amount` 是非负 canonical decimal，
`currency` 是三位大写货币代码，`source.id` 标识回执字段或公开契约。明确报告的零是已知成本，优先于任何估算。
Adapter 不能通过这个入口提交 estimated cost；market、gateway 与 surcharge 等旁路金额留在 Adapter 自有原始附件中。

`inputTokens` 排除缓存读取与写入；`inputTotalTokens` 是独立观测到的含缓存输入总量。
可选 `cacheReadTokens`、`cacheWriteTokens` 和 `inputTotalTokens` 省略时为 `null`，不得为了补全而填零。
所有已知计数必须是非负安全整数；明确的零保留为已知零。已知分项之和不得超过已知总量，分项全部已知时必须相等。
总量与分项独立保存，不重复相加，也不根据不完整分项补算总量。

`attempt.usage` 返回 `source: "adapter"`、`coverage: "recorded-calls"`、调用快照和各计数的已知小计。
未知值保留，部分小计标为 partial；已上报快照完整不代表包含外部系统的全部调用。单次最多返回前 128 条调用，
`callsTruncated` 与 `omittedCallCount` 明示截断；聚合仍包含已封存的全部调用。

每个调用最多选择一个 effective cost：有 reported cost 时直接采用，包括零；否则 NiceEval 只按显式 configured fixed pricing profile
与已封存 token 桶形成 estimate proof。缺少价格、token 或 cache 专用 rate 时保持 unknown 或 partial，不回退 input rate。
内置 catalog 没有可证的 flat applicability 时不参与估算。revision 1 的历史用量只读投影新增字段为 `null`，不会按当前价格重算。

显式 fixed pricing profile 复用 `defineConfig({ pricing })`。旧的 input/output 配置保持有效，metadata 为可选扩展：

```ts
pricing: {
  "openai/gpt-5.6-luna": {
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    cacheReadPerMTok: 0.02,
    cacheWritePerMTok: 0.25,
    basis: "catalog-reference",
    currency: "USD",
    source: { id: "project-fixed-prices", asOf: 1_789_718_400_000 },
  },
}
```

省略 metadata 的既有配置使用 `configured-profile`、`niceeval.config.pricing` 与 `asOf: null`，不会伪造时间。
receipt 保存实际命中的 exact 或 provider wildcard selector、有效 rate 与 profile digest。配置只接受有限非负 number；框架把 rate 转为 canonical decimal 后做确定十进制计算。

成本小计按货币分开，`reported | estimated | mixed` 只说明已采用金额的 provenance kind。完整度另由完整调用数决定。
partial estimate 可以贡献已知金额并计入 `estimatedCalls`，但不计入 `coveredCalls`。采集 partial、未知金额与非 USD 金额都会使对应 USD 投影保留缺口。

Overview 的 token 指标逐次调用选择可用输入总量：`inputTotalTokens` 已知时只采用它，否则汇总已知的 `inputTokens`、
`cacheReadTokens` 与 `cacheWriteTokens`，再加 `outputTokens`。它不把输入总量与缓存分项重复相加。缺少任一必要分项时保留
已知小计并标为 partial；全部未知才是 unavailable。显式零是已知零，没有用量 attachment 的旧 Attempt 仍是 unavailable。

用量入口与附件入口共用 Attempt 的有界 cleanup 生命周期。取消后 cleanup 未结束时仍可上报；
关闭后的调用拒绝且不能改写已封存事实。关闭前的采集错误即使被作者捕获，也保留为最终执行错误。

## 读取官方用量与耗时

Adapter 用 `ctx.recordUsage(call)` 上报每个物理请求的最终快照，评估从同一账本读取，不汇总应用 journal。



```ts
const usage = t.usage;
if (usage.source === "adapter") {
  t.check(usage.totalTokens, atMost(10_000)).gate();
  t.check(usage, customUsageScore).score(30);
}
t.maxTokens(10_000).gate();
t.maxCost(0.1).gate();
t.check(t.elapsedMs, atMost(60_000)).gate();
```

usage 的 source 为 adapter、agent 或 unavailable；Adapter 的 basis 为 recorded-calls。

Adapter快照范围是本 Attempt 在调用处已上报的全部物理请求，包括失败与重试。


快照深度冻结且与账本隔离；后续 cleanup 上报不修改已登记断言。

Agent 使用同一 EvalUsage 形状，其 basis 为 reported-sends，按 Turn、Session 或 Attempt 选择实际 invoke 的用量贡献。


inputTotalTokens 优先于互斥输入/缓存桶求和；totalTokens再加outputTokens，不重复计算输入。


数量为 exact、lower-bound 或 unavailable。

未知字段不补0；超出 safe integer 为 unavailable。


NumericMaterial 保留 provenance 的 source/scope/unit/cut；字段提取后仍可复核范围。



maxCost 比较USD有效成本：优先实扣金额（包括0），否则仅用显式pricing的封存估算。

十进制精确比较，不隐式兑换币种。


已知超额可失败；只有全部请求都有完整USD金额才通过；混合币种或缺失金额为下界或 unavailable。


elapsedMs使用runtime的Attempt单调时钟起点到调用处的墙钟毫秒，包含setup和等待，不包含未来cleanup。


游戏时钟或首次完成时间由应用事实提供，不能用墙钟代替。

## 读取模型用途并关联调用

`AdapterCreateContext.models` 是当前 Attempt 的只读映射，每项为 `{ model: string | null; reasoningEffort: string | null }`。
配置由 [Experiment](../experiments/library.md#普通-adapter-的命名模型用途) 冻结，Adapter 不另复制一份模型 flags。

`recordUsage` 可带 `modelSlot?: string | null`。它引用当前配置的用途键，不要求实际 model 与配置相同。
省略或 null 表示用途未登记，不推断为 default；非法引用沿既有采集错误通道失败，不能捕获后当作完整调用账本封存。
同模型的不同用途保留独立分组，retryOf 和 callId 仍标识物理请求。
新普通 Adapter 即使没有调用也封存完整空账本，旧 Record 缺源仍未知。

用量 revision 4 保存必有的 modelSlot 与显式采集完整性；revision 1 与 2 只读投影用途为 null，revision 3 保留原用途。
旧版本原金额与应用 costUSD 保留，新整局和实验总费用对缺少生产者声明的旧账本保留 application 缺口，不重写旧字节。
