# Observability —— transcript、 artifact 与报告

> 状态:标准事件流归一化、o11y 摘要、OTLP trace 归一化(线格式层 + 语义层 mapper)、artifact 落盘、用量成本与内置 reporters 均已实现。「OTLP traces」一节里 span 与事件流合并成 `ExecutionTree`(`buildExecutionTree(events, spans)`,供 `niceeval show --execution` 等消费)与一等 `skill.loaded` 事件,是已定稿但尚未实现的设计。

评测的价值不止"过/挂",更在"为什么"。这一篇讲三件事:agent 的 **transcript** 如何被归一化成统一 trace、跑完落盘的**artifact**长什么样、**报告器**如何把结果回传。

这是 niceeval "看得快"承诺的落点,见 [Vision](vision.md#看得快)。

## Transcript → 标准事件流

每个 agent 都吐自己格式的 transcript(Claude Code 一种 JSONL、Codex 另一种、bub 又一种)。直接消费这些就得到处写 `if (agent === ...)`。adapter 的核心活,就是把它**归一化**成那条[标准事件流 `StreamEvent[]`](feature/adapters/contract.md#标准事件流) —— 它既是 trace,也是整套断言的唯一数据源,断言和报告只面对它。

每个 agent 一个解析器,住在 `o11y/parsers/<agent>.ts`,把原始 JSONL 映射成标准 `StreamEvent[]`。**这是接新 agent 的第二件事**(第一件是 adapter 的 `send`):没有解析器,trace 就退化成不透明字符串。归一化失败不崩:保留原始 JSONL,并在该 eval 的 `result.json` 上标 `parseSuccess: false`。

事件里工具调用的名字(`action.called.name`)被归一化到一组**规范名**,便于跨 agent 断言:

```typescript
type ToolName =
  | "file_read" | "file_write" | "file_edit"
  | "shell" | "web_fetch" | "web_search"
  | "glob" | "grep" | "list_dir" | "agent_task" | "unknown";
```

core 再从这条流派生两样:`deriveRunFacts(events)`(toolCalls / subagents / parked,供断言,见 [Adapter 契约](feature/adapters/contract.md#派生事实core-算共享agent-无关)),以及下面给人/给沙箱内手工跑的验证测试看的 o11y 摘要。

原始 transcript 具体怎么从 agent CLI 弄到手(磁盘旁读 / stdout 捕获 / OTLP 推送)、采集层与转换层的边界怎么分,属于"怎么写 adapter"的范畴,见 [Adapter 写法 · 采集层](feature/adapters/authoring.md#采集层原始数据怎么从-agent-cli-弄到手)。

## o11y 派生摘要

从归一化事件派生出一份给人和给断言看的摘要:

```typescript
interface O11ySummary {
  totalTurns: number;
  toolCalls: Record<ToolName, number>;   // { file_read: 15, shell: 8, … }
  totalToolCalls: number;
  filesRead: string[];
  filesModified: string[];
  shellCommands: { command: string; exitCode?: number; success?: boolean }[];
  webFetches: { url: string; status?: number; success?: boolean }[];
  errors: string[];
  thinkingBlocks: number;
  durationMs: number;                    // 本次运行的 wall-clock 耗时(运行器计时)
  usage: Usage;                          // 累加这个 attempt 所有轮的 token 用量
  estimatedCostUSD?: number;             // usage × 价格表换算(见下)
}
```

### 注入沙箱:让测试断言「行为」

这份摘要被写进沙箱的 `__niceeval__/results.json`,于是你在沙箱里手工跑的验证测试能断言 agent **干了什么**,而不只是**产出了什么**:

```typescript
const o11y = JSON.parse(readFileSync("__niceeval__/results.json", "utf-8")).o11y;

// 用了正确的脚手架,而不是手搓
expect(o11y.shellCommands.some((c) => c.command.includes("create-next-app"))).toBe(true);
// 没有读不该读的文件
expect(o11y.filesRead).not.toContain(".env");
// 工具调用没失控
expect(o11y.totalToolCalls).toBeLessThan(50);
```

这把"过程正确性"也纳入了评分,而不只是"结果正确性"。

## OTLP traces → 统一瀑布图

`StreamEvent` 回答「做了什么」;**trace 回答「各花了多久、谁套谁」**。配了 OTel 接入的 agent(沙箱型声明 `tracing` 块;remote agent 配 `defineConfig({ telemetry })`)经 OpenTelemetry 把 OTLP traces 导出到运行器(沙箱型每个沙箱起一个本机 OTLP/HTTP 接收器,remote agent 共享一个固定端口接收器,端点经 `ctx.telemetry.endpoint` 交给 agent),跑完归一成 `TraceSpan[]` 挂到 `EvalResult.trace`,`niceeval view` 画成瀑布图。

**断言永远只读事件流,从不读 span。** `send` 返回的 `Turn.events` 是断言唯一的数据源,这一条没有变过——多了 trace 也不给断言开后门。变的是**展示层怎么用这两条数据**:span 不再只喂瀑布图,还作为**可选 enrichment** 合并进事件骨架,构成 `ExecutionTree`,供 `niceeval show --execution` 这类需要「一份读完」的视图消费。

**这一条和本文档此前记录的决策相反。** 此前的设计是「事件流与 span 完全独立、永不合并」,理由是断言不该依赖脆弱的 span 关联——一旦断言读 span,span 归属判错就会直接污染判分。这条顾虑本身没有过期,新设计把它原样保留:**断言依然只读事件流,span 从不产出、也从不改写任何 `StreamEvent`**。变的是给人 / agent 看的那一面——把 events 和 trace 分成两份文件、两套 renderer 去读,对着一次失败要来回翻两个视图拼时间线;`ExecutionTree` 用纯函数 `buildExecutionTree(events, spans)` 把两者合并成一份视图,只服务展示,不反哺判分。

`ExecutionTree` 的骨架就是标准事件流本身:`message`、`thinking`、`skill.loaded`(**新增的一等事件**——agent 加载 Skill 时归一化直接产出,不再靠「识别到叫 `load_skill` 的工具调用」这类按名字猜的老办法)、`action.called`/`action.result`(按 `callId` 合并成一个调用节点)、`subagent.called`/`subagent.completed`、`input.requested`、`compaction`、`error`。**骨架的节点、顺序、内容永远不因 OTel 有没有接入而变**——OTel span 只是叠加在同一个节点上的可选信息:起止时间、耗时、父子关系、错误状态。合并靠**显式 correlation ID 或 GenAI 语义约定属性**(如 `gen_ai.tool.call.id`),**永远不靠拿 span 名字 / 文本去猜哪个事件对应哪个 span**。没有 OTel 接入时,节点照样全部显示,只是耗时标「timing unavailable」;span 存在但唯一关联不上任何事件时,保留成一个单独标注的 telemetry-only 节点,不悄悄猜着合并到某个事件上。

这条线分两层,两层都得归一,但**含义层(语义约定)才是接新 agent 的真功夫**:

| 层 | 干什么 | 谁做 |
|---|---|---|
| **线格式层** | OTLP/JSON(codex)、OTLP/protobuf(bub)→ 统一的 `TraceSpan[]` | core `o11y/otlp/parse.ts`,通用,接新 agent 不用碰 |
| **语义层** | span 名 / 属性的**含义**(「这是模型调用」「这是工具执行」) | **每个 agent 一个薄 mapper**(见下) |

### canonical 目标 = OpenTelemetry GenAI 语义约定(不发明私有 schema)

不同 agent 的 span 命名 / 属性约定天差地别(codex 的 `codex.exec`、bub 插件的 `agent.step` / `execute_tool`)。直接把原生 span 喂给 view 就是**苹果对橘子**:名字、属性键都不一样,跨 agent 没法叠加对比 —— 而横向对比是本套件的全部意义(同一任务、不同 memory 条件 / 不同 agent 比通过率 × 时间 × 成本)。

**定下来的规矩:canonical 目标就是 OpenTelemetry 官方的 [GenAI 语义约定](https://opentelemetry.io/docs/specs/semconv/gen-ai/),不另造 niceeval 私有 schema。** 理由:

1. **它是行业标准**,codex 的 OTLP 已部分遵循、bub 的 otel 插件可配置直接发 `gen_ai.*`。
2. **我们不控制 agent 的 instrumentation** —— codex(Rust)、claude 发什么是什么。造私有 schema 也强迫不了它们原生发,最终只能在我们这侧归一;那不如归一到一个公认标准,而不是又一套只有 niceeval 认得的键。

canonical 的核心是用 `gen_ai.operation.name` 把 span 分成几类语义角色(view 据此着色 / 分组 / 对比):

| `gen_ai.operation.name` | niceeval `kind` | 含义 |
|---|---|---|
| `chat` / `text_completion` | `model` | 一次模型调用 |
| `execute_tool` | `tool` | 一次工具执行 |
| `invoke_agent` / `create_agent` | `agent` / `turn` | 一次 agent / 回合调用 |
| (其余 / 未识别) | `other` | plumbing,view 默认折叠 |

配套属性一律走 GenAI 键:`gen_ai.request.model`、`gen_ai.usage.input_tokens` / `output_tokens`(`derive.ts` 的 `extractUsageFromSpans` 已经在认这套)、`gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.agent.name`。

### 每个 agent 一个薄 mapper

和 transcript 解析器(`o11y/parsers/<agent>.ts`)**完全对称**:每个 agent 再加一个 span mapper,把它的原生 span 归一到 canonical GenAI semconv。mapper 只做一件事 —— 认出「这条 span 是模型调用 / 工具执行 / 回合」,补上 `gen_ai.operation.name` 与相关 `gen_ai.*` 属性,**保留 raw `name` / `attributes` 供下钻**。

> **mapper 越薄越好:能在源头对齐就别在 mapper 里补。** codex 的 `config.toml`、bub 插件的配置尽量让它们直接发 `gen_ai.*`;源头发对了的 agent,mapper 近乎透传。mapper 是「上游不肯按标准发」时的兜底,不是主力。

这把 `o11y/otlp/select.ts` 里那串「猜各 agent 命名约定」的正则全删掉 —— agent 特定知识回到 agent 自己手里(和 parser 同一个归属原则),`select` 退化成纯通用逻辑:按 `kind != "other"` 留、按 firehose 频率丢。

### view 只认 canonical

**view 不读任何原生 span 名 / 原生属性。** 它只消费归一后的字段:`gen_ai.operation.name` → `kind` 着色分组,`gen_ai.*` 取模型 / 工具 / 用量。后果:

- 接新 agent **不用动 view** —— 只要 mapper 把它归一到 canonical。
- 两个 agent 的瀑布图**天然对齐、可叠加对比**(同一种颜色 = 同一种语义)。
- 没写 mapper(或 mapper 没认出)的 span 落进 `other`,view 折叠不渲染细节 —— **降级但不崩**,也不污染对比。

### agent 定义里 otel 怎么放(两块责任分开)

otel 在 agent 定义里其实是**两个互不相干的责任,分开放**,别都塞进 `setup` / `send`:

1. **导出配置(adapter 侧的 `tracing` 块)** —— 「怎么让这个 CLI 把 OTLP 发到 endpoint」。从 `setup`/`send` 抽出来,做成 agent 定义里一个声明式 `tracing` 块(见 `AgentTracing`)——这个块存在,运行器就为该 agent 开 OTLP 接收,不需要另外声明什么开关。两种投递方式(按 CLI 而定,互不排斥):

   ```typescript
   defineSandboxAgent({
     tracing: {
       protocol: "http/protobuf",
       // env-based(标准 OTEL_* env,如 bub/Python OTel SDK):给 endpoint → 返回 env。
       // 运行器把它算进 ctx.telemetry.env,send 直接 `{ ...ctx.telemetry?.env }` 注入。
       env: (endpoint) => ({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint, /* … */ }),
       // file-based(CLI 自有配置文件,如 codex 的 config.toml [otel] 块):给 sandbox + ctx,
       // 自己写/追加配置。运行器在 setup 之后、首次 send 之前调一次(子表天然落在主配置之后)。
       configure: async (sandbox, ctx) => { /* 把 [otel] 块追加进 config.toml */ },
     },
     async setup(sb) { /* 只装 CLI / 写主配置,不碰 otel */ },
     async send(input, ctx) { /* env: { ...auth(), ...ctx.telemetry?.env } */ },
   });
   ```

   为什么要 env / configure 两条路:bub(Python OTel SDK)读标准 `OTEL_*` env,codex(Rust)**不读** env、只认自己 `config.toml` 的 `[otel]` 块 —— 这是上游差异,抹不平,所以两种投递都得支持。

2. **span mapper(core o11y 侧)** —— 「原生 span → canonical」。**纯数据变换,不碰沙箱**,和 transcript parser 一样住 core 的 o11y(`o11y/otlp/mappers/<agent>.ts`),可独立单测。分派靠接口不靠名字:adapter 在 `defineSandboxAgent` / `defineAgent` 里用 `spanMapper` 声明自己的 mapper,运行器只调 `agent.spanMapper`,未声明的走通用 heuristic 兜底 —— core 不出现 agent 名字的行为分支。

**为什么要分:** 导出配置是「沙箱里怎么发」,mapper 是「发回来怎么读」—— 一个需要沙箱、一个是纯函数,生命周期和测试方式都不同。混在 `setup`/`send` 里,既难单测 mapper、又让 adapter 把 otel 拼装逻辑揉进主流程。`ctx.telemetry` 则统一带上 `{ endpoint, env? }`:env-based agent 拿 `env` 直接 spread,file-based agent 在 `configure` 里用 `endpoint`。

> **claude-code:** 已接原生 OTLP(beta 遥测):adapter 的 `tracing.env` 注入 `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_*`(见 `src/agents/claude-code.ts`)。span 层级 `claude_code.interaction → llm_request / tool`,只有结构与计时、内容默认脱敏——内容与断言仍来自 transcript 旁读,trace 只补瀑布图。span 量级小(每回合个位数),`selectTraceSpans` 的 small-trace 路径整段保留,不需要专属 mapper。曾考虑过的「transcript 时间戳合成 span」方案不再需要。

### span 怎么归属到轮

spans 是异步推来的,必须知道「这批 span 属于哪一轮 `send`」。接收器的**粒度**跟**被测进程**走,不是跟 attempt 走:

- **沙箱型 agent**:每沙箱一个接收器。每个沙箱是独立进程,env 注入各自端点,attempt 之间端口天然隔离。
- **remote agent**:整个 run **共享一个接收器**(`defineConfig({ telemetry })` 钉住的固定端口)。被测应用只有一条全局 OTel 管线、一个导出目标,做不到"给每条并行 eval 发不同端点"——并行 attempts 的 span 混在同一条流里,这是共享被测对象的物理事实,不是实现选择。

共享流之下的归属阶梯:

- **traceparent(并发正确性的必要条件)**:`ctx.telemetry.headers` 是每轮一个新值的 W3C trace context,`send` 把它 spread 进请求头;支持 context 传播的埋点(标准 OTel HTTP 服务端埋点、Claude Code 的 `TRACEPARENT`、LangSmith 检测 global provider)把本轮 span 挂到这个 trace 下,按 traceId 精确归属,并发随便开。
- **窗口法(兜底,仅串行可靠)**:runner 在 `send` 前记时间戳,`send` 返回后取窗口内的 span。并发 attempts 的窗口互相重叠,窗口法归属必然混流。
- **并发守卫**:共享接收器 + 未确认 traceparent 生效(收到的 span 不带我们发的 traceId)+ 该 agent 并发 > 1 → runner 把该 agent 的 attempts 降为串行并提示。宁可慢,不可静默混流;确认 traceparent 生效后解除。

## Artifact 落盘

落盘单位是**结果快照**(一个 experiment 的一次运行):默认 `Artifacts()` reporter 把每个实验写进独立的快照目录,当前目录结构是:

```text
.niceeval/
  <experiment>/                      # 实验目录:experimentId 清洗后的名字
    <timestamp>-<suffix>/            # 快照目录:时间戳 + 随机后缀,独占创建
      snapshot.json                  # 快照元数据(快照开始时写入,收尾补 completedAt)
      <evalId>/a<attempt>/           # 单个 eval attempt 的目录
        result.json                  # 判决、断言、用量 —— attempt 完成时一次写成
        events.json
        sources.json
        trace.json
        o11y.json
        diff.json
```

`snapshot.json` 只放身份与版本元数据(`experimentId`、`agent`、`model`、`startedAt`、收尾补写的 `completedAt`),**不含任何逐 attempt 数据**。判决与断言的权威记录住在每个 attempt 目录的 `result.json`——attempt 完成时一次写成,之后不再改写;通过数、失败数、总用量、总成本这类聚合不落盘,由读取面([Results Lib](results-lib.md)的 `openResults`)逐条推导。每个 attempt 的重数据按需写入自己的目录,文件内容都是 JSON array/object,不是 JSONL / NDJSON。完整 schema、版本号设计、路径转义规则和 view 读取规则见 [Results Format](results-format.md)。

`result.json` 形如:

```json
{
  "id": "weather/brooklyn",
  "verdict": "passed",
  "attempt": 1,
  "durationMs": 2184,
  "hasEvents": true, "hasTrace": false, "hasSources": true,
  "assertions": [
    { "name": "succeeded", "severity": "gate", "score": 1, "passed": true },
    { "name": "calledTool(get_weather)", "severity": "gate", "score": 1, "passed": true }
  ]
}
```

`verdict` 只有 `passed` / `failed` / `errored` / `skipped` 四态,没有 `scored` 中间态(soft 断言的分数就在 `assertions[].score` 里如实记录,不影响这四态)。`failed` 与 `errored` 是互斥判定:前者表示断言/评分不通过,后者表示环境、超时、adapter 或 agent runtime 这类执行错误。JUnit reporter 也按这个口径输出 `<failure>` 与 `<error>`。

artifact 是机器可读的,可回放、可二次分析、可喂给下游 dashboard。

## 用量与成本(token / 计费)

评测很贵 —— 每个 case 可能是几十次模型调用。**「花了多少 token / 多少钱」是一等公民**,因为评 coding agent 时最值钱的对比维度是**质量 × 成本**:同一批 eval 跑 claude-code / codex / bub,谁的通过率高、谁更省钱,一目了然。

参考项目这块都是空的:eve 在模型层有 token 数但 eval 不聚合成本;agent-eval 连抠都没抠(opencode 解析器里只留了句 "could extract token usage if needed" 的 TODO)。niceeval 把它补齐。

### 用量从哪来

`Usage`(`{ inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, requests? }`)按 transport 取得,作者通常**什么都不用做**:

- **远程 agent** —— 你在 `send` 里把模型返回的 usage(或你服务响应里带的 usage,若它回了)一并返回。
- **沙箱 coding agent** —— **不必手填**:agent 的 JSONL transcript 里本就逐条带 token 用量,transcript 解析器(`o11y/parsers/<agent>.ts`)抠出来。这正是 agent-eval 留下的 TODO。

每轮的用量来源二选一:remote agent 由 `Turn.usage` 直接给,sandbox agent 由解析器从该轮 transcript 抠出。运行器把每轮累加 → 单 eval 用量(落进 `O11ySummary.usage`);reporter 再跨 eval 累加 → 整个 run 的用量。

### 换算成本:价格表从哪来

token 数能可靠拿到;难点是 token→$ 的价格表 —— 价格会随时间、provider、网关、企业折扣、自托管而变,写死必然过期。所以成本解析是**分层的,且"实测优先于估算"**:

1. **网关实测成本(最高优先)。** 不少网关(Vercel AI Gateway、OpenRouter…)每次请求直接回真实 cost。只要 agent 把它带进 `Turn.usage.costUSD`,就直接用它 —— **根本不需要价格表**。这绕开了一大半场景。
2. **内置默认价格表 ⊕ 用户覆盖。** 没有实测时,用观测到的模型查价。niceeval 内置一份**带版本的快照**覆盖常见模型(零配置即有 $),用户在 config 里**覆盖或补充**(网关/企业折扣/自托管/自定义费率,用户赢):

   ```typescript
   // niceeval.config.ts —— 合并在内置默认之上,用户优先
   defineConfig({
     pricing: {
       "anthropic/claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
       "openai/gpt-5.2-codex":      { inputPerMTok: 1.25, outputPerMTok: 10 },
       "my-selfhosted/*":           { inputPerMTok: 0, outputPerMTok: 0 }, // 自托管=免费
     },
   });
   ```
3. **未知模型 → 只报 token、不报 $,并打一行 warning** 列出没映射的模型(绝不静默瞎猜)。

`estimatedCostUSD = inputTokens×单价 + outputTokens×单价 + cache…`,落进 `O11ySummary` 与每个 attempt 的 `result.json`。字段名带 **estimated** 是有意的:它是估算,真实账单以 provider 发票为准 —— 这也正是「网关实测」和「用户覆盖」两条通道存在的原因。

> 设计取舍:价格是**会过期的数据**,所以内置快照只为「零配置能用」,不写死进核心逻辑;准确性靠用户覆盖与网关实测兜底,未知则诚实降级。快照随版本更新,也可考虑 `pricing: "auto"` 从社区维护的价目拉取(默认仍用离线快照,保证确定性)。

### 报告里长什么样

控制台每个 eval 末尾带用量,整个 run 带合计与按 agent 的对比:

```text
  ✓ recall-across-sessions   (42s)   38.2k tok   $0.31
  ✓ remember-styling-conv    (51s)   61.7k tok   $0.48

Run totals:  3 evals · 142k tok · $1.12   (agent: claude-code)
```

每个 attempt 的 `result.json` 都带这三件套(注意:**时间 / token / 成本始终成组出现**):

```json
{
  "id": "recall-across-sessions",
  "durationMs": 42100,
  "usage": { "inputTokens": 32000, "outputTokens": 6200, "cacheReadTokens": 0, "requests": 5 },
  "estimatedCostUSD": 0.31
}
```

run 级合计不落盘:总时长、总用量、总成本由消费方([Results Lib](results-lib.md)的 `openResults` 逐条推导,或 reporter 层现算)累加得到。这让「跨 agent 对比」从只有 pass-rate 变成 **pass-rate × 时间 × $**,也能算出 pass@$1(单位成本下的通过率)这类指标。

### 时间也是一等指标(效率三件套)

成本不是新指标里唯一的一个。**wall-clock 时间一直就记录**——运行器给每个 attempt 整体计时,落进 `O11ySummary.durationMs`,现在和 token / 成本**并排**成组:

| 维度 | 粒度 | 来源 |
|---|---|---|
| **时间(wall-clock)** | 每 attempt / 整个 run(+ 平均) | 运行器计时,adapter 不用做事 |
| **token 用量** | 同 | 标准事件流 / transcript 抠出 |
| **估算成本 $** | 同 | usage × 价格表(或网关实测) |

这份计时是**聚合粒度**的:`O11ySummary.durationMs` 只有整个 attempt 一个数,`StreamEvent` 本身不带任何一次工具调用 / 任何一轮的耗时。要细到「这次工具调用花了多久」「这一轮模型想了多久」,唯一的来源是 OTel span——见上面 [ExecutionTree](#otlp-traces--统一瀑布图):有 span 且能唯一关联上就在对应节点显示耗时,没有就诚实显示 timing unavailable,不拿整个 attempt 的耗时去反推单个节点。

三个都留是因为**它们不总相关**:命中缓存的运行可能便宜但慢,推理重的可能贵但快 —— 只看一个会误判。所以控制台 `(42s) 38.2k tok $0.31` 三个并列,`niceeval view` 也能画「质量 × 成本 × 延迟」。

### 把成本变成可断言 / 可护栏的维度

- **断言效率**(见 [Scoring](scoring.md#5-效率成本断言)):`t.maxTokens(50_000)` / `t.maxCost(0.5)` —— agent 答对了但烧太多,也判失败。
- **预算护栏**:`--budget <usd>` 给整个 run 设上限,累计花费超了就停止派发新 attempt(借鉴 crabbox 的 spend cap),避免一次跑爆账单。

## 结果可视化:`niceeval view`

控制台是「当下」的;但你常常想**事后看图**:这次比上次贵了多少?哪个 agent 性价比高?所以 niceeval 提供一个本地查看器(对标 agent-eval 的 playground:一个读结果目录的 web UI),只读 `.niceeval/<experiment>/<snapshot>/` 下的 `snapshot.json` 与逐 attempt `result.json` 这些**结构化 artifact**,不连任何外部服务。结果落盘格式见 [Results Format](results-format.md);查看器现状、已知的文档差异和计划中的功能(比如挑两次运行对比)见 [View](view.md)。

可视化能力完全建立在「 artifact 结构化 + 带 usage/cost」之上 —— 换句话说,**只要数据采全了,图是免费的**;不想用内置查看器,同一份 artifact 也能喂给下游 dashboard。

托管看板走 reporter 通道(见下),把每次运行作为一个实验上报到 Braintrust 这类平台,跨提交比较与团队共享。

## Reporters

报告器消费运行结果,实现三个回调:

```typescript
interface Reporter {
  onRunStart(evals: Eval[], agent: Agent): void | Promise<void>;
  onEvalComplete(result: EvalResult): void | Promise<void>;
  onRunComplete(summary: RunSummary): void | Promise<void>;
}
```

报告器在**独立串行队列**上被回调,不阻塞执行池(见 [Runner](runner.md#调度有界并发))。内置:

- **`Console()`** —— 默认,流式逐行输出,失败断言内联展开。
- **`Artifacts()`** —— 默认按实验写快照目录(`.niceeval/<experiment>/<snapshot>/`):`snapshot.json` 快照元数据 + 每个 attempt 的 `result.json`(判决、断言、用量,一次写成)与按需生成的 `events.json`、`sources.json`、`trace.json`、`o11y.json`、`diff.json`,供 `niceeval view` 读取。具体格式见 [Results Format](results-format.md)。
- **`JUnit(path)`** —— JUnit XML,接 CI 测试报告 UI。
- **`Json(path)`** —— 机器可读全量。
- **`Braintrust(config?)`** —— 把一次运行作为一个 Braintrust experiment 上报,每个 attempt 一行:soft 断言按名字记分,gate 断言记在 `gate:` 前缀下(实验 diff 里 gate 回归和 soft 分数回归用同一套机制看);metrics 带 start/end、token 用量与估算成本,metadata 带 agent / model / experiment / flags 身份维度与失败断言明细。`braintrust` 包是可选 peer 依赖(动态 import,没装时 onRunStart 报错并提示安装);鉴权走 `BRAINTRUST_API_KEY` 或工厂参数 `apiKey`。源码 `src/runner/reporters/braintrust.ts`。

配置全局或单 eval 专用:

```typescript
import { Braintrust, JUnit } from "niceeval/reporters";

// niceeval.config.ts —— 全局,观测所有 eval(Console / Artifacts 由 CLI 始终自带,不用写)
defineConfig({ reporters: [JUnit(".niceeval/junit.xml"), Braintrust({ project: "weather" })] });

// 某个 eval 专用:实例只观测引用它的 eval
defineEval({ reporters: [Braintrust({ project: "weather" })], async test(t) { ... } });
```

eval 级 reporter 经作用域包装接入(`scopeReporter`,见 `src/runner/report.ts`):`onEvalComplete` 按 eval id 过滤,`onRunComplete` 收到重新计数的子集汇总;同一实例被多个 eval 引用时合并观测集(共享一个目的地,比如同一个 Braintrust 实验),已经挂在全局 `reporters` 里的实例在 eval 上再列一遍也不会重复上报。

## 失败分类(可选,沙箱型)

沙箱型可开 AI 失败分类:跑完用一个小模型(给它只读探索结果目录的工具:list/read/grep)把失败归为三类:

- **model** —— agent 试了但代码不对(测试挂)。
- **infra** —— 基础设施坏了(API 错误、限流、崩溃、无 transcript)。
- **timeout** —— 撞了时限。

分类缓存进 `classification.json`。这让你在一大批失败里快速分清"是模型不行"还是"环境抖了",而不用逐个翻日志。

## 相关阅读

- [Scoring](scoring.md) —— 作用域断言如何消费 o11y。
- [Runner](runner.md) —— 报告队列与 artifact 落盘的调度。
- [Results Format](results-format.md) —— `.niceeval/<experiment>/<snapshot>/` 的目录结构与 JSON 文件契约。
- [Adapter 写法](feature/adapters/authoring.md) —— 接新 agent 需要的解析器、采集层怎么弄到原始数据。
- [agent-eval 参考:采集 / 转换 / 落地三层](feature/adapters/reference/agent-eval.md) —— Vercel agent-eval 怎么写 adapter 的学习记录。
