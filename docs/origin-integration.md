# Origin 应用接入手册

`examples/zh/origin/` 下五个独立应用,按应用逐个说明怎么把它们接进 niceeval,产出按分档铺在 `examples/zh/tier1|tier2|tier3/<name>/`(分层索引见 [examples/zh · 接入分层](../examples/zh/origin/README.md#接入分层origin-tier1-tier2-tier3))。本文记录接入配方和各应用的陷阱,再接一个类似的应用时可以照抄;权威来源永远是各 tier 目录的源码和各自的 README,本文只是导读。

先记住三条铁律:

1. **不改 origin 的任何文件。** 接入产物放 `examples/zh/tier1/<同名>/`:从 origin 复制整个应用,被复制的文件保持逐字节不变(除 `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三个集成脚手架文件,以及 `.env.example`——tier 侧要补 judge 独立凭证等 eval 变量),接入代码全部是**新增**文件。`pnpm run gen:diff-code` 会 diff origin 和 tier1 两个目录生成 before/after 文档页,"应用侧零改动"是这些页面的核心卖点,改一个字节都会破坏它;这条铁律由 CI 的 `pnpm tiers:check`(verbatim 校验)看守,见 [tier-sync](engineering/example-tier-sync/README.md)。
2. **协议以实际输出为准。** 动手写映射之前,先把应用跑起来,`curl -N` 打一轮 `/api/chat` 把 SSE 帧看一遍。本文的帧格式描述来自当前代码,但代码会演化,别背文档。
3. **被测应用由你自己按它的方式启动,eval 不代管进程、不另开端口。** adapter 只经环境变量(如 `CODEX_SDK_URL`)指向一个已经在跑的实例——没有 `server-lifecycle.ts` 这类"eval 侧拉起子进程"的机制,这是刻意的取舍,理由见[接入你的 Agent · 为什么不直调](../docs-site/zh/tutorials/connect-your-agent.mdx)同一条脉络(eval 不代管被测进程)。

## Tier 是什么,产出长什么样

接入分三档(定义见 [docs-site · Tier](../docs-site/zh/explanation/tier.mdx)):**Tier 1(只接 send)**、**Tier 2(send + OTel)**、**Tier 3(侵入改造 + experiment flags)**。

三档各有物化目录,同一个应用逐层叠 delta:`tier1/<name>`(纯无侵入,全套断言)、`tier2/<name>`(有 OTel 输出的三个应用:ai-sdk-v7、codex-sdk、langgraph——加 telemetry 配置与 spanMapper/收尾宽限,换瀑布图)、`tier3/<name>`(五个应用都有——按文末「Tier 3 侵入点」改应用内部代码,暴露 experiment flags)。哪个应用有哪几层见 [examples/zh 分层索引](../examples/zh/origin/README.md#接入分层origin-tier1-tier2-tier3);层间用 `pnpm tiers:sync` 保持同步(机制见 [tier-sync](engineering/example-tier-sync/README.md))。本文余下部分讲 Tier 1 的接入配方——那是每个应用的地基。

## 统一的接入配方

五个应用的形态高度一致(HTTP 服务 + SSE 流式响应),所以 adapter 的骨架也一致。差异只在:帧格式怎么翻、session 字段叫什么、有没有审批流、有没有 OTel。

### 目录布局

```text
examples/zh/tier1/<name>/
├── (origin 的完整副本,逐字节不变,除三个集成脚手架文件)
├── package.json / pnpm-workspace.yaml / tsconfig.json   集成脚手架(diff 页如实展示,允许)
├── niceeval.config.ts      新增
├── agents/<name>.ts        新增:adapter 本体——只剩传输粘合,没有 server 生命周期代码
├── evals/*.eval.ts         新增
└── experiments/*.ts        新增
```

### adapter 骨架

adapter 的 `send` 每轮做的事,按顺序,不声明任何 `capabilities`——`t` 上解锁什么由 `send` 实际做到了什么决定(见[能力由构造证明](feature/adapters/architecture/agent-contract.md#能力由构造证明)):

```ts
// agents/<name>.ts
import { defineAgent, sseJsonFrames, driveFrameStream } from "niceeval/adapter";

const BASE_URL = process.env.<NAME>_URL ?? "http://127.0.0.1:<port>";  // 应用自己的端口,eval 不代管进程

export default defineAgent({
  name: "<name>",
  // 有 OTel 的应用才需要:spanMapper 把应用私有 span 归一成 canonical,只影响瀑布图。
  // spanMapper: mapCodexSpans,
  async send(input, ctx) {
    // 回答轮:先查有没有停轮现场(HITL),有就把裁决交回应用,接着读同一条流
    const pending = ctx.session.take<Pending>();
    if (pending) {
      const approved = input.responses?.[0]?.optionId === "approve";
      await postApprove(pending.requestId, approved, ctx.signal);
      return readStream(pending.cursor, ctx, pending.stream);
    }

    // 正常轮:发请求。session 续接:ctx.session.id 新会话线自然是 undefined,
    // 拿到应用回的 id 后用 ctx.session.capture() 写回(只在还没记过时落地)
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, sessionId: ctx.session.id }),
      signal: ctx.signal,
    });

    // 逐帧读 SSE,用官方转换器(有的话)或手写映射翻成 StreamEvent;
    // 碰到审批帧就 ctx.session.hold() 存住现场、返回 waiting;流正常结束就返回 completed
    return driveFrameStream(sseJsonFrames(res.body!), reducer, ctx, onFrame);
  },
});
```

`driveFrameStream` / `sseJsonFrames` 从 `niceeval/adapter` 导出,是逐帧驱动循环的官方件,五个 adapter 共用思路(langgraph/pi 的自定义帧、claude 的 SDKMessage、codex 的 ThreadEvent 都是这一种传输)。有官方转换器的用官方转换器(`fromClaudeSdkMessages` / `fromPiAgentEvents` / `fromCodexThreadEvents`),没有的手写一张"帧类型 → StreamEvent"映射表。

事件词汇表(`message` / `action.called` / `action.result` / `input.requested` …)见 [docs-site 事件流参考](../docs-site/zh/reference/events.mdx)。映射三要点:按真实顺序、`callId` 配对、不漏帧——漏帧只是让这条 eval 的负断言不可信,不是运行时错误。

模型对比怎么做:多数应用走 `AGENT_MODEL` 环境变量(启动应用时指定),ai-sdk-v7 例外——它的接口本身收请求级 `model` 字段,`ctx.model` 直接透传,同一个 server 实例就能测多个模型,不用重启。

### HITL:审批流怎么接

先理解应用侧的机制:**应用在等审批时,SSE 流保持打开**——服务端把执行卡在一个 Promise/队列上,审批决定走**另一个** `POST /api/chat/approve` 请求,resolve 之后原来那条 SSE 继续吐帧直到结束。

adapter 要这样做:

1. `send` 读流,读到审批帧(各应用帧名见小节)时**不要关流**——把「读了一半的流 + 待批准的 callId」存进 `ctx.session.hold()`(不是模块级 `Map`——这是逃过 attempt/session 边界串用状态的关键),返回 `waiting` + `input.requested` 事件。
2. 下一次 `send`(就是 eval 里的 `t.respond("approve"/"deny")`)先 `ctx.session.take()` 取回停轮现场:有,就按 `input.responses[0].optionId`(不是解析 `text`)判断批准与否,`POST /api/chat/approve`(body 字段名各应用不同!claude/pi 是 `toolUseId`,langgraph 是 `toolCallId`),然后**继续读原来那条流**到结束,把剩余帧作为这一轮的 events 返回。
3. 拒绝(`deny`)时,把被拒工具的 `action.result` 的 `status` 置 `"rejected"`,不是 `"failed"`。

没有审批流的应用(codex-sdk)跳过这一整节,永远不返回 `waiting`。

### OTel:只画瀑布图,和事件映射完全无关(这一节的产物在 tier2)

不管应用有没有 OTel 输出,事件映射(上面几节讲的)都一样要做——**OTel 只喂 `niceeval view` 的调用瀑布图,不产出任何事件,也不影响任何断言**,详见 [Observability · OTLP traces](observability.md#otlp-traces-统一瀑布图)。

五个应用里,ai-sdk-v7、codex-sdk、langgraph 发 OTel span,claude-sdk、pi-sdk 不发(claude-sdk 的 CLI 遥测只有 metrics+logs,niceeval 只消费 trace spans;pi-agent-core 没有官方 OTel 集成)。这层接线是 Tier 2 的 delta,落在 `examples/zh/tier2/<name>/`(tier1 不配 telemetry、没有瀑布图);有 span 的应用接法都一样:

1. `niceeval.config.ts` 钉住固定接收端口:`defineConfig({ telemetry: { port: 4318 } })`——写了这个配置就等于给非沙箱 agent 打开了 OTel 接收。
2. 启动应用时,把标准 OTel 环境变量指向这个端口(`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces` 或应用自己的等价配置)。
3. 应用私有的 span 命名如果不是标准 GenAI semconv(比如 codex 自家 span),给 agent 声明 `spanMapper`(codex 有内置 `mapCodexSpans`)把它归一成 canonical,瀑布图才能正确着色分组。
4. 没有 span 到齐的问题(`BatchSpanProcessor` 缓冲导致最后一批 span 晚到)属于观测完整性,不是断言问题——ai-sdk-v7、langgraph 的 adapter 都在流结束后主动等一小段(`settleMs` / grace period)把收集窗口拉宽,只影响瀑布图,断言与它无关。

**并发须知**:五个 origin 的 HTTP 层都没接 OTel 服务端埋点,不会传播 `ctx.telemetry.headers` 里的 traceparent——所以 span 按时间窗口归属,该 agent 的轮次自动串行(runner 会打日志提示,宁可慢不混流)。这是正确行为,不是 bug;要解锁并发得应用侧接 W3C trace context 传播(属于 Tier 3 范畴的应用侧改动)。

## 各应用速查

| | 端口 | 请求体 | 帧格式 | session 字段 | HITL | 模型选择 | OTel(仅瀑布图) |
|---|---|---|---|---|---|---|---|
| ai-sdk-v7 | 34001 | `{messages[], model}` | AI SDK UI Message Stream | 无(整份 messages 重放) | 流内(SDK 机制) | 请求体 `model` | ✅ 官方 `@ai-sdk/otel`,标准 GenAI 语义 |
| claude-sdk | 32001 | `{message, sessionId}` | SDKMessage 原样透传 | `sessionId`(SDK 落盘) | `/api/chat/approve` `toolUseId` | env `AGENT_MODEL` | ❌ 只有 metrics+logs |
| codex-sdk | 31001 | `{message, threadId}` | ThreadEvent 原样透传 | `threadId`(SDK 落盘) | 无 | env `AGENT_MODEL` | ✅ codex 自家 span,`spanMapper: mapCodexSpans` 归一 |
| pi-sdk | 33001 | `{message, sessionId}` | AgentEvent 透传 + 3 种自定义帧 | `sessionId`(服务端内存) | `/api/chat/approve` `toolUseId` | env `AGENT_MODEL` | ❌ 无 |
| langgraph | 35000 | `{message, sessionId}` | 自定义 JSON 帧 | `sessionId` = thread_id(进程内存) | `/api/chat/approve` `toolCallId` | env `AGENT_MODEL` | ✅ LangSmith OTel 导出 |

启动命令、必需的 key 见各 `examples/zh/tier1/<name>/README.md` 和 `.env.example`。下面只写映射和陷阱,详细实现以 `agents/<name>.ts` 源码为准。

### ai-sdk-v7

- 内置的 `uiMessageStreamAgent`(`niceeval/adapter` 导出)整个托管了这个应用——不需要手写 `send`,adapter 缩成纯配置(`url` + `body(ctx)` 透传 `ctx.model` + `settleMs`)。会话续接(客户端全量重放)、HITL 审批改写重发、事件直构全部是这个内置件的事。
- 模型对比:请求体 `model` 字段,`ctx.model` 直接透传,server 不用重启,可选值看 `GET /api/models`。
- OTel:应用用官方 `@ai-sdk/otel`,产标准 GenAI span;`niceeval.config.ts` 钉固定端口,应用启动时环境变量指过来。应用用 `BatchSpanProcessor`,span 可能晚到几秒——`settleMs: 600` 把收集窗口拉宽一点,只影响瀑布图完整性。
- 备注:**进程内直调不被推荐**(被测对象是用户实际部署的应用,走 HTTP;测函数不等于测生产路径,详见[接入你的 Agent · 为什么不直调](../docs-site/zh/tutorials/connect-your-agent.mdx))——这个示例统一走无侵入 HTTP 接入,不提供进程内直调的对照版本。

### claude-sdk

- 帧是原生 `SDKMessage`,官方转换器 `fromClaudeSdkMessages`(`niceeval/adapter` 导出)直接映射:`system`(带 `session_id`,写回 `ctx.session.capture()`)→ `assistant`(content blocks)→ `user`(`tool_result` 按 `tool_use_id` 配对)→ `result`(usage/cost)。逐帧驱动是官方件 `driveFrameStream`。
- **HITL 没有显式的"等审批"帧**——`canUseTool` 把流卡住,`driveFrameStream` 的 `onFrame` 钩子扫 derived 事件,认出被门控的工具(`mcp__demo-tools__calculate`,写死在 adapter 里,必须和应用 `agent.ts` 里的 `GATED_TOOL_NAME` 完全一致)就返回 `{ pause }`。approve 端点偶发 404(SDK 内部注册 resolver 有竞态)时短退避重试几次,不是真的没有这次审批。
- 无 trace spans(CLI 原生遥测只有 metrics+logs,niceeval 不消费),不声明 `spanMapper`,瀑布图这个应用没有——写进 eval README,不是失误。
- 模型:`AGENT_MODEL` 注入子进程(代码默认 `deepseek-v4-flash`,`.env.example` 是 `claude-sonnet-5`,以 `.env.example` 为准)。

### codex-sdk

- 帧是原生 `ThreadEvent`,官方转换器 `fromCodexThreadEvents`(`niceeval/adapter` 导出)映射:`thread.started`(带 `thread_id`,写回 session)→ `item.*` 系列(`agent_message` → `message`;`command_execution` / `file_change` / `mcp_tool_call` → 配对的 `action.called`/`action.result`)→ `turn.completed`(usage)/ `turn.failed` / `error`。
- 无 HITL,永不返回 `waiting`。它是编码 agent,eval 测「在工作目录里写文件、跑命令」这类真实任务,用 `node:fs` 直接核实磁盘上的真实内容,不只信模型自述。
- OTel:codex CLI 原生 OTLP,长驻服务必须 run 级共享接收器(固定端口模式)。span 是 codex 自家命名,声明 `spanMapper: mapCodexSpans`(`niceeval/adapter` 公开导出)归一后瀑布图和内置 `codexAgent` 一致——**事件断言的数据来源始终是 `ThreadEvent` 流,和 span 无关**。
- 模型:`AGENT_MODEL`(默认 `gpt-5.4`),自定义 provider 走 `CODEX_BASE_URL`。

### pi-sdk

- 手写映射路线最完整的示范:无 OTel、有 HITL、服务端内存 session。帧 = 原生 `AgentEvent`(官方转换器 `fromPiAgentEvents` 映射)+ 三种自定义传输帧:`{type:"session", sessionId}`(写回 session)、`{type:"approval_request", toolCallId, toolName, args}`(→ `input.requested` + `waiting`,`driveFrameStream` 的 `onFrame` 里返回 `{ pause }`)、`{type:"server_error", message}`(→ `failed`)。
- HITL 走标准配方,approve 端点字段 `toolUseId`。
- session 在服务端内存里,**跑多轮 eval 时不要重启应用**,重启即丢会话。
- 无 OTel。模型:`AGENT_MODEL`,只有 `deepseek-v4-flash` / `deepseek-v4-pro` 两个可选。

### langgraph

- 唯一的 Python 应用,也是唯一**完全手写帧映射、零 OTel 依赖用于事件**的应用:自定义 JSON 帧(`tool-input` → `action.called`、`tool-output` → `action.result`(completed,帧带 `isError: true` 时 failed)、`tool-output-denied` → `action.result`(rejected)、`text-delta` 累积成 `message`、`tool-approval-request` → `input.requested` + `waiting`)。工具异常靠 `ToolRetryMiddleware(max_retries=0, on_failure="continue")` 落成 `status="error"` 的 ToolMessage——`create_agent` 默认让工具异常炸穿整张图,没有这层就表达不了"执行了但失败"。
- HITL 标准配方,**approve 端点字段是 `toolCallId`**(别照抄 claude/pi 的 `toolUseId`)。
- session 是 `InMemorySaver`,同 pi:应用不要中途重启。
- OTel:LangSmith 导出的 span 只用来画瀑布图(`niceeval.config.ts` 固定端口 + 应用侧 `LANGSMITH_TRACING` / `LANGSMITH_OTEL_ENABLED` / `LANGSMITH_OTEL_ONLY` 三个环境变量),事件断言完全不依赖它。LangSmith 的 `BatchSpanProcessor` 调度和 SSE 流关闭是两条独立时间线,adapter 在轮次结束后主动等一小段(grace period)把最后一批 span 收进瀑布图。

## 每个应用要写的 eval(最低集合)

1. **基础问答**:`t.send` 一轮,`t.succeeded()` + 文本断言。
2. **工具调用**:触发工具,`t.calledTool` / `t.toolOrder` / `t.noFailedActions`。
3. **多轮记忆 + 隔离**:第一轮报名字、第二轮问名字;`t.newSession()` 再问,新会话不应知道——这条专门验证会话续接没写错(最常见 bug:adapter 没有正确使用 `ctx.session` 存取器,导致跨会话线串用历史,隔离静默失真)。
4. **HITL 批准 + 拒绝**(有审批流的应用):`waiting` → `respond("approve")` → `calledTool(..., {status:"completed"})`;拒绝分支断 `status:"rejected"`。
5. **用量/成本**(能拿到 usage 的应用):`t.maxTokens` 冒烟。

experiment 至少两个单配置文件，可放在 `compare-models/` 路径下方便批量选择（ai-sdk-v7 / claude-sdk / pi-sdk 有多模型可比）；路径不声明比较边界。

## 验收清单(每个应用)

- [ ] `git status` 确认 origin 目录零改动;tier1 目录里被复制的应用文件与 origin 逐字节一致(除三个集成脚手架文件)
- [ ] `pnpm run typecheck` 通过
- [ ] `npx niceeval exp <基线>` 全绿;`npx niceeval view` 里事件流完整(message + action 配对)
- [ ] 多轮记忆和 `newSession()` 隔离两条 eval 都过
- [ ] 有 HITL 的:approve / deny 两条都过,deny 的工具结果是 `rejected` 不是 `failed`
- [ ] 有 OTel 的:view 瀑布图非空
- [ ] eval README 写明这个应用做不到什么(没有 OTel 的写清楚、负断言不完全靠事件完整性证明的写清楚)

## Tier 3 侵入点(产出在 examples/zh/tier3/)

feature A/B test 的做法:每个应用挑一个最小侵入点做成**请求体可选字段**(不是环境变量——环境变量意味着换变体要重启应用,一次 experiment 运行里 A/B 不了;默认行为不变的铁律不变):

- ai-sdk-v7:system prompt(`instructions`)、工具子集(`tools`)→ `tier3/ai-sdk-v7`;
- claude-sdk:system prompt → `tier3/claude-sdk`;
- codex-sdk:`threadOptions` 的 sandbox mode → `tier3/codex-sdk`;
- pi-sdk:system prompt → `tier3/pi-sdk`;
- langgraph:system prompt(变体各自编译图、共享 checkpointer)→ `tier3/langgraph`。

experiment 侧用 `flags` → `ctx.flags` 透传,写法见 [Experiments](feature/experiments/README.md);每个 tier3 目录的 README 有完整的 flags 流动链路。

## 接入沉淀的官方件

- **`uiMessageStreamAgent`**(`src/agents/ui-message-stream.ts`,从 `niceeval/adapter` 导出):AI SDK UI Message Stream 协议的内置无侵入 adapter,`tier1/ai-sdk-v7` 的 adapter 因此缩成纯配置。
- **`fromCodexThreadEvents`**:ThreadEvent 的工具项(`command_execution` / `mcp_tool_call` / `file_change` → 配对的 `action.*`)与 `turn.completed` 的 usage 聚合,是 `tier1/codex-sdk` 事件断言的唯一数据来源(不依赖任何 span 派生)。
- **`mapCodexSpans`**(`src/o11y/otlp/mappers/codex.ts`,从 `niceeval/adapter` 导出):把 codex 自家 span 命名归一成 canonical GenAI 语义,只用来让瀑布图和内置 `codexAgent` 保持一致。

五个应用各有一个 before/after 文档页(`gen:diff-code` 生成),挂在 `docs-site/docs.json` 导航。
