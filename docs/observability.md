# Observability —— transcript、工件与报告

评测的价值不止"过/挂",更在"为什么"。这一篇讲三件事:agent 的 **transcript** 如何被归一化成统一 trace、跑完落盘的**工件**长什么样、**报告器**如何把结果回传。

这是 fasteval "看得快"承诺的落点,见 [Vision](vision.md#看得快)。

## Transcript → 标准事件流

每个 agent 都吐自己格式的 transcript(Claude Code 一种 JSONL、Codex 另一种、bub 又一种)。直接消费这些就得到处写 `if (agent === ...)`。adapter 的核心活,就是把它**归一化**成那条[标准事件流 `StreamEvent[]`](agents-and-adapters.md#标准事件流adapter-的核心难点) —— 它既是 trace,也是整套断言的唯一数据源,断言和报告只面对它。

每个 agent 一个解析器,住在 `o11y/parsers/<agent>.ts`,把原始 JSONL 映射成标准 `StreamEvent[]`。**这是接新 agent 的第二件事**(第一件是 adapter 的 `send`):没有解析器,trace 就退化成不透明字符串。归一化失败不崩:保留原始 JSONL,并在该 eval 的 `result.json` 上标 `parseSuccess: false`。

事件里工具调用的名字(`action.called.name`)被归一化到一组**规范名**,便于跨 agent 断言:

```typescript
type ToolName =
  | "file_read" | "file_write" | "file_edit"
  | "shell" | "web_fetch" | "web_search"
  | "glob" | "grep" | "list_dir" | "agent_task" | "unknown";
```

core 再从这条流派生两样:`deriveRunFacts(events)`(toolCalls / subagents / parked,供断言,见 [Agents 与 Adapters](agents-and-adapters.md#派生事实core-算共享agent-无关)),以及下面给人/给 `EVAL.ts` 看的 o11y 摘要。

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
  usage: Usage;                          // 累加这次运行所有轮的 token 用量
  estimatedCostUSD?: number;             // usage × 价格表换算(见下)
}
```

### 注入沙箱:让测试断言「行为」

这份摘要被写进沙箱的 `__fasteval__/results.json`,于是 `EVAL.ts` 能断言 agent **干了什么**,而不只是**产出了什么**:

```typescript
const o11y = JSON.parse(readFileSync("__fasteval__/results.json", "utf-8")).o11y;

// 用了正确的脚手架,而不是手搓
expect(o11y.shellCommands.some((c) => c.command.includes("create-next-app"))).toBe(true);
// 没有读不该读的文件
expect(o11y.filesRead).not.toContain(".env");
// 工具调用没失控
expect(o11y.totalToolCalls).toBeLessThan(50);
```

这把"过程正确性"也纳入了评分,而不只是"结果正确性"。

## OTLP traces → 统一瀑布图

`StreamEvent` 回答「做了什么」;**trace 回答「各花了多久、谁套谁」**。带 `tracing` 能力的 agent 经 OpenTelemetry 把 OTLP traces 导出到运行器(每个沙箱起一个本机 OTLP/HTTP 接收器,端点经 `ctx.telemetry.endpoint` 交给 agent),跑完归一成 `TraceSpan[]` 挂到 `EvalResult.trace`,`fasteval view` 画成瀑布图。

这条线分两层,两层都得归一,但**含义层(语义约定)才是接新 agent 的真功夫**:

| 层 | 干什么 | 谁做 |
|---|---|---|
| **线格式层** | OTLP/JSON(codex)、OTLP/protobuf(bub)→ 统一的 `TraceSpan[]` | core `o11y/otlp/parse.ts`,通用,接新 agent 不用碰 |
| **语义层** | span 名 / 属性的**含义**(「这是模型调用」「这是工具执行」) | **每个 agent 一个薄 mapper**(见下) |

### canonical 目标 = OpenTelemetry GenAI 语义约定(不发明私有 schema)

不同 agent 的 span 命名 / 属性约定天差地别(codex 的 `codex.exec`、bub 插件的 `agent.step` / `execute_tool`)。直接把原生 span 喂给 view 就是**苹果对橘子**:名字、属性键都不一样,跨 agent 没法叠加对比 —— 而横向对比是本套件的全部意义(同一任务、不同 memory 条件 / 不同 agent 比通过率 × 时间 × 成本)。

**定下来的规矩:canonical 目标就是 OpenTelemetry 官方的 [GenAI 语义约定](https://opentelemetry.io/docs/specs/semconv/gen-ai/),不另造 fasteval 私有 schema。** 理由:

1. **它是行业标准**,codex 的 OTLP 已部分遵循、bub 的 otel 插件可配置直接发 `gen_ai.*`。
2. **我们不控制 agent 的 instrumentation** —— codex(Rust)、claude 发什么是什么。造私有 schema 也强迫不了它们原生发,最终只能在我们这侧归一;那不如归一到一个公认标准,而不是又一套只有 fasteval 认得的键。

canonical 的核心是用 `gen_ai.operation.name` 把 span 分成几类语义角色(view 据此着色 / 分组 / 对比):

| `gen_ai.operation.name` | fasteval `kind` | 含义 |
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

1. **导出配置(adapter 侧的 `tracing` 块)** —— 「怎么让这个 CLI 把 OTLP 发到 endpoint」。从 `setup`/`send` 抽出来,做成 agent 定义里一个声明式 `tracing` 块(见 `AgentTracing`),和 `capabilities.tracing` 开关放一起。两种投递方式(按 CLI 而定,互不排斥):

   ```typescript
   defineSandboxAgent({
     capabilities: { tracing: true },
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

2. **span mapper(core o11y 侧)** —— 「原生 span → canonical」。**纯数据变换,不碰沙箱**,和 transcript parser 一样住 core 的 o11y(`o11y/otlp/mappers/<agent>.ts`,按 agent 名键),可独立单测。

**为什么要分:** 导出配置是「沙箱里怎么发」,mapper 是「发回来怎么读」—— 一个需要沙箱、一个是纯函数,生命周期和测试方式都不同。混在 `setup`/`send` 里,既难单测 mapper、又让 adapter 把 otel 拼装逻辑揉进主流程。`ctx.telemetry` 则统一带上 `{ endpoint, env? }`:env-based agent 拿 `env` 直接 spread,file-based agent 在 `configure` 里用 `endpoint`。

> **claude-code 缺口:** 它根本不发 OTLP(`capabilities` 里没有 `tracing`)。但它的 transcript JSONL 带时间戳,可从 `StreamEvent` + 时间戳**合成 span**(synthetic spans),再走同一个 canonical schema —— 让三个 agent 都有瀑布图、对比表不缺一角。合成器同样住 core o11y,与 mapper 并列。

## 工件落盘

每次运行落一份结构化工件到 `.fasteval/<时间戳>/`:

```text
.fasteval/2026-06-28T10-30-45/
├─ summary.json                  # 运行汇总(各判决计数、agent、起止时间)
├─ results.jsonl                 # 每行一个 eval 结果(紧凑)
└─ evals/
   ├─ weather-brooklyn.json      # 单 eval 详细结果 + 断言
   ├─ weather-brooklyn.events.ndjson   # 标准事件流(StreamEvent[])
   └─ fixtures-button/
      ├─ result.json             # status / durationMs / usage / cost / observedModel / o11y / parseSuccess
      ├─ events.ndjson           # 标准事件流(StreamEvent[],归一化后)
      ├─ trace.json              # OTLP traces 归一成的 TraceSpan[](canonical = GenAI semconv,有 tracing 能力时)
      ├─ transcript-raw.jsonl    # agent 原始 JSONL(debug 用,仅沙箱型有)
      ├─ outputs/
      │  ├─ eval.txt             # EVAL.ts 输出
      │  └─ scripts/build.txt    # npm script 输出
      └─ project/                # agent 生成的文件(copyFiles 时)
         └─ src/Button.tsx
```

`summary.json` 形如:

```json
{
  "agent": { "name": "claude-code", "transport": "sandbox", "sandbox": "docker" },
  "startedAt": "2026-06-28T10:30:45.000Z",
  "completedAt": "2026-06-28T10:31:23.000Z",
  "passed": 8, "failed": 1, "scored": 2, "skipped": 0, "errored": 0,
  "evals": [
    { "id": "weather/brooklyn", "verdict": "passed",
      "assertions": [
        { "name": "succeeded", "severity": "gate", "score": 1, "passed": true },
        { "name": "calledTool(get_weather)", "severity": "gate", "score": 1, "passed": true }
      ] }
  ]
}
```

工件是机器可读的,可回放、可二次分析、可喂给下游 dashboard。

## 用量与成本(token / 计费)

评测很贵 —— 每个 case 可能是几十次模型调用。**「花了多少 token / 多少钱」是一等公民**,因为评 coding agent 时最值钱的对比维度是**质量 × 成本**:同一批 eval 跑 claude-code / codex / bub,谁的通过率高、谁更省钱,一目了然。

参考项目这块都是空的:eve 在模型层有 token 数但 eval 不聚合成本;agent-eval 连抠都没抠(opencode 解析器里只留了句 "could extract token usage if needed" 的 TODO)。fasteval 把它补齐。

### 用量从哪来

`Usage`(`{ inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, requests? }`)按 transport 取得,作者通常**什么都不用做**:

- **进程内 agent** —— 你在 `send` 里把模型返回的 usage 一并返回。
- **远程 agent** —— 从你服务的响应里取(若它回了 usage)。
- **沙箱 coding agent** —— **不必手填**:agent 的 JSONL transcript 里本就逐条带 token 用量,transcript 解析器(`o11y/parsers/<agent>.ts`)抠出来。这正是 agent-eval 留下的 TODO。

每轮的用量来源二选一:remote agent 由 `Turn.usage` 直接给,sandbox agent 由解析器从该轮 transcript 抠出。运行器把每轮累加 → 单 eval 用量(落进 `O11ySummary.usage`);reporter 再跨 eval 累加 → 整轮用量。

### 换算成本:价格表从哪来

token 数能可靠拿到;难点是 token→$ 的价格表 —— 价格会随时间、provider、网关、企业折扣、自托管而变,写死必然过期。所以成本解析是**分层的,且"实测优先于估算"**:

1. **网关实测成本(最高优先)。** 不少网关(Vercel AI Gateway、OpenRouter…)每次请求直接回真实 cost。只要 agent 把它带进 `Turn.usage.costUSD`,就直接用它 —— **根本不需要价格表**。这绕开了一大半场景。
2. **内置默认价格表 ⊕ 用户覆盖。** 没有实测时,用观测到的模型查价。fasteval 内置一份**带版本的快照**覆盖常见模型(零配置即有 $),用户在 config 里**覆盖或补充**(网关/企业折扣/自托管/自定义费率,用户赢):

   ```typescript
   // fasteval.config.ts —— 合并在内置默认之上,用户优先
   defineConfig({
     pricing: {
       "anthropic/claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
       "openai/gpt-5.2-codex":      { inputPerMTok: 1.25, outputPerMTok: 10 },
       "my-selfhosted/*":           { inputPerMTok: 0, outputPerMTok: 0 }, // 自托管=免费
     },
   });
   ```
3. **未知模型 → 只报 token、不报 $,并打一行 warning** 列出没映射的模型(绝不静默瞎猜)。

`estimatedCostUSD = inputTokens×单价 + outputTokens×单价 + cache…`,落进 `O11ySummary` 与 `summary.json`。字段名带 **estimated** 是有意的:它是估算,真实账单以 provider 发票为准 —— 这也正是「网关实测」和「用户覆盖」两条通道存在的原因。

> 设计取舍:价格是**会过期的数据**,所以内置快照只为「零配置能用」,不写死进核心逻辑;准确性靠用户覆盖与网关实测兜底,未知则诚实降级。快照随版本更新,也可考虑 `pricing: "auto"` 从社区维护的价目拉取(默认仍用离线快照,保证确定性)。

### 报告里长什么样

控制台每个 eval 末尾带用量,整轮带合计与按 agent 的对比:

```text
  ✓ recall-across-sessions   (42s)   38.2k tok   $0.31
  ✓ remember-styling-conv    (51s)   61.7k tok   $0.48

Run totals:  3 evals · 142k tok · $1.12   (agent: claude-code)
```

`summary.json` 增加(注意:**时间 / token / 成本三件套始终成组出现**):

```json
{
  "durationMs": 93400,
  "usage": { "inputTokens": 980000, "outputTokens": 64000, "cacheReadTokens": 410000, "requests": 73 },
  "estimatedCostUSD": 1.12,
  "perEval": [
    { "id": "recall-across-sessions", "durationMs": 42100, "usage": { … }, "estimatedCostUSD": 0.31 }
  ]
}
```

这让「跨 agent 对比」从只有 pass-rate 变成 **pass-rate × 时间 × $**,也能在 reporter 层算出 pass@$1(单位成本下的通过率)这类指标。

### 时间也是一等指标(效率三件套)

成本不是新指标里唯一的一个。**wall-clock 时间一直就记录**(`StreamEvent` 里每个工具调用有 `durationMs`,运行器还包住每个 `send` 和整个 eval 计时),现在和 token / 成本**并排**成组:

| 维度 | 粒度 | 来源 |
|---|---|---|
| **时间(wall-clock)** | 每 turn / 每 eval / 整轮(+ 平均) | 运行器计时,adapter 不用做事 |
| **token 用量** | 同 | 标准事件流 / transcript 抠出 |
| **估算成本 $** | 同 | usage × 价格表(或网关实测) |

三个都留是因为**它们不总相关**:命中缓存的运行可能便宜但慢,推理重的可能贵但快 —— 只看一个会误判。所以控制台 `(42s) 38.2k tok $0.31` 三个并列,`fasteval view` 也能画「质量 × 成本 × 延迟」。

### 把成本变成可断言 / 可护栏的维度

- **断言效率**(见 [Scoring](scoring.md#5-效率成本断言)):`t.maxTokens(50_000)` / `t.maxCost(0.5)` —— agent 答对了但烧太多,也判失败。
- **预算护栏**:`--budget <usd>` 给整轮设上限,累计花费超了就停止派发新 attempt(借鉴 crabbox 的 spend cap),避免一次跑爆账单。

## 结果可视化:`fasteval view`

控制台和 `summary.json` 是「当下」的;但你常常想**事后看图**:这次比上次贵了多少?哪个 agent 性价比高?所以 fasteval 提供一个本地查看器(对标 agent-eval 的 playground:一个读结果目录的 web UI)。

```sh
fasteval view                         # 起本地 web,读 .fasteval/ 下所有历史运行
fasteval view .fasteval/<run>/summary.json
fasteval view --out .fasteval/report.html  # 导出静态 HTML
```

它不连任何服务,只读 `.fasteval/<时间戳>/` 这些**结构化工件**(每 eval 已带 `usage` + `estimatedCostUSD`),因此能渲染:

- **运行总览** —— pass / fail / scored 计数、总 token、总 $。
- **experiment 对比榜单** —— 同一批 eval 下各个实验配置的通过率 + 平均耗时 + token + 成本并列;agent/model 是实验配置的属性,不是主键。这是评 coding agent 最想要的一张图。
- **eval attempt 钻取** —— 点开单行看具体 eval 的断言、错误、耗时、用量与样例 JSON。
- **质量 × 成本散点** —— 每个 eval(或每个 agent)一个点,一眼看出「贵且不准」的角落。
- **跨运行趋势** —— 每次运行是带时间戳的目录,于是成本 / 通过率能画成随提交变化的折线,抓性能或成本回归。
- **transcript 钻取** —— 点开单个 eval 看归一化事件流、工具调用、改了哪些文件。
- **trace 瀑布图** —— 把 `trace.json` 画成时间轴瀑布。只读 canonical(`gen_ai.operation.name` → `kind`、`gen_ai.*`),**不认任何原生 span 名** —— 所以不同 agent 的图天然对齐、可叠加对比;没归一的 span 落 `other`、折叠不渲染。

可视化能力完全建立在「工件结构化 + 带 usage/cost」之上 —— 换句话说,**只要数据采全了,图是免费的**;不想用内置查看器,同一份工件也能喂给下游 dashboard。

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
- **`Artifacts()`** —— 默认写 `.fasteval/<timestamp>/summary.json` 与 `results.jsonl`,供 `fasteval view` 读取。
- **`JUnit(path)`** —— JUnit XML,接 CI 测试报告 UI。
- **`Json(path)`** —— 机器可读全量。
- **第三方实验跟踪** —— 接 Braintrust 这类平台,把每次运行作为一个实验上报,跨提交比较。

配置全局或单 eval 专用:

```typescript
// fasteval.config.ts —— 全局,观测所有 eval
defineConfig({ reporters: [Console(), JUnit(".fasteval/junit.xml")] });

// 某个 eval 专用
defineEval({ reporters: [Braintrust({ project: "weather" })], async test(t) { ... } });
```

## 失败分类(可选,沙箱型)

沙箱型可开 AI 失败分类:跑完用一个小模型(给它只读探索结果目录的工具:list/read/grep)把失败归为三类:

- **model** —— agent 试了但代码不对(测试挂)。
- **infra** —— 基础设施坏了(API 错误、限流、崩溃、无 transcript)。
- **timeout** —— 撞了时限。

分类缓存进 `classification.json`。这让你在一大批失败里快速分清"是模型不行"还是"环境抖了",而不用逐个翻日志。

## 相关阅读

- [Scoring](scoring.md) —— 作用域断言如何消费 o11y。
- [Runner](runner.md) —— 报告队列与工件落盘的调度。
- [Agents 与 Adapters](agents-and-adapters.md) —— 接新 agent 需要的解析器。
