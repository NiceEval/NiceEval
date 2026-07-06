# Concepts

什么时候读这一篇:

- 你碰到一个不认识的 niceeval 术语;
- 你在写文档 / 代码,想跟现有用法保持一致;
- 你需要一页纸把整套词汇过一遍。

这是一份术语表。两个同义词并存时,**首选写法**用粗体。

## 评测核心词汇

**Eval** —— 评测的最小单元。一个 Eval = 一个 [Task](#task) 跑在一个 [Agent](#agent) 上,由若干 [Scorer](#scorer) 判分。统一由 `defineEval` 定义——会话型和沙箱型不是两个定义函数,`test(t)` 里 `t` 要不要带 `t.sandbox`,取决于引用的 [Agent](#agent) 是不是 `defineSandboxAgent` 构造的(`kind: "sandbox"`),不取决于用哪个 define 函数。每个 Eval 有一个从路径推导的 **id**。

**Task** —— 要让被测对象完成的"那件事"。不管会话型还是沙箱型,都是一串 `t.send(...)` 的输入——沙箱型只是 `t` 多了 `t.sandbox`,任务本身照样写在 `t.send(...)` 里。Task 描述意图,不描述如何判分。

**Agent** —— "一条连到 AI 的连接"的抽象,由 experiment 引用。`Agent.kind` 只有两类:`"remote"`(按你自己服务的协议发请求,`defineAgent` 产出)、`"sandbox"`(在 [Sandbox](#sandbox) 里 spawn coding agent 的 CLI,`defineSandboxAgent` 产出)。进程内直调你的函数不是独立的第三类——它只是 `kind: "remote"` 的 `send` 里选择怎么实现的一种写法,而且不是推荐写法(测函数不等于测生产路径,详见[接入你的 Agent · 为什么不直调](../docs-site/zh/guides/connect-your-agent.mdx))。运行器只认统一动词 `send`,`t` 上暴露哪些动作由 Agent 的[能力](#capability)决定——能力不是声明出来的,是 `send` 实际做到了什么的构造证据。niceeval 不定义任何 agent 协议,所以没有 `--url`、没有通用 http target —— 连你自己的服务也是写一个 agent,URL 是它的内部配置。详见 [Agents 与 Adapters](adapters/README.md)。

**Scorer** / **评分器** —— 把"结果"映射成分数的东西。三类:**值级断言**(`expect` 里的 `includes`/`equals`/`matches`…;`check` 记录并继续,`require` 作为前置条件立即等待并失败中止)、**作用域断言**(`t.succeeded()`/`t.calledTool()`…,在 `test` 结束后对本次 eval run 聚合评估;同一套断言挂在 [Session](#运行与结果) 上则只看这条 session,挂在 [Turn](#运行与结果) 上则只看这一轮)、**LLM-as-judge**(用一个评判模型给开放式回答打分)。沙箱型里,手工在沙箱内跑验证命令,再用 `t.check(result, commandSucceeded())` 判定,本身也是一种 Scorer。

**Assertion** / **断言** —— Scorer 的一次具体应用,带名字、严重级([gate / soft](#severity))、可选阈值,产出一个 0–1 的分数和过/挂。

**Outcome** / **判决** —— 一个 Eval 的评分结论,只有四态:`passed` / `failed` / `errored` / `skipped`。规则:显式 `t.skip(reason)` → `skipped`;执行出错(超时、异常、作者错误)→ `errored`;任一 gate 断言不过,或 `--strict` 下有 soft 断言低于阈值 → `failed`;否则 → `passed`。**没有 `scored` 这个中间态**——soft 断言没达标,在非 `--strict` 下就是 `passed`,分数照样如实记录、供横向对比,只是不影响这四态判定。`failed` 只表示断言/评分不通过,`errored` 是环境、超时、adapter、agent runtime 等执行问题,两者互斥,报告、JUnit、CI 都按这个口径分开统计,别把 `errored` 当成 agent 任务做错了。

**Severity** / **严重级** —— 断言的两档。**gate**:硬性要求,不过即判 `failed`,任何时候都生效。**soft**:质量分,不会单独让 eval 立即 `failed`——`.atLeast(x)` 本身就是 soft 带阈值的写法:非 `--strict` 下低于阈值仍判 `passed`(分数如实记录),`--strict` 下才降级为 `failed`;不调 `.atLeast()` 时走匹配器自己的默认档(如 judge 默认 soft、无阈值,纯记分永不 fail)。

## 被测对象与适配器

**Adapter** / **适配器** —— 某个 [Agent](#agent) 的具体实现,**由用户编写**(niceeval 也内置几个常用 coding agent 的 adapter)。一个 Adapter 实现一个 Agent:远程型(`kind: "remote"`)按你服务的协议发请求,沙箱型(`kind: "sandbox"`)则拥有该 agent 的 CLI 参数、认证方式、默认模型、transcript 位置等全部特殊性。接新 agent = 加一个 Adapter,不动核心。同一个 agent 可有多个变体(如直连 API vs 经网关)。

**Sandbox** / **沙箱** —— 封装"在哪里、如何隔离地跑命令"的对象。统一接口:`workdir` / `runCommand` / `readFile` / `writeFiles` / `uploadDirectory` / `stop`。实现包括 Docker、Vercel Sandbox、其它三方。命令工作目录通过 `runCommand` / `runShell` 的 `cwd` option 表达,不提供可变的 working directory。

**workdir** —— 沙箱内 agent 的默认工作目录,也是 git 基线和 diff 采集的锚点;绝对值随后端不同(docker `/home/sandbox/workspace`、e2b `/home/user/workspace`、vercel `/vercel/sandbox`)。API 里所有沙箱侧相对路径、省略的 `targetDir` / `cwd` 都解析到它;eval 作者用相对路径写完整条 eval,必须要绝对路径时读 `t.sandbox.workdir`。详见 [Sandbox · 路径与 workdir](sandbox.md#路径与-workdir一个坐标系)。

**Sandbox author API** / **沙箱作者 API** —— 沙箱型 eval 里暴露给 `test(t)` 的 `t.sandbox`。它分三类:文件 IO(`writeFiles` / `readFile`)、命令执行(`runCommand` / `runShell`)和结果断言 / diff(`fileChanged` / `diff` / `file`)。沙箱生命周期由 runner 管,`stop()` 不暴露给 eval 作者。

**Backend** / **后端** —— 某个 Sandbox 的具体实现选择(`docker` / `vercel` / …)。`auto` 表示按环境探测(有云 token 用云,否则用 Docker)。

**Capability** / **能力** —— `t` 上暴露哪些动作(会话续接、工具调用观测、文件 diff、trace…),完全由**构造证据**决定,不是声明式的能力位:`send` 里接了 `ctx.session` 的续接存取器就有多轮,返回过 `waiting` + `input.requested` 就有 HITL,用官方转换器就带完整性证明(负断言可信),`defineSandboxAgent` 构造就有 `t.sandbox`。`Agent` 接口上不存在 `capabilities` 字段。核心**按构造证据分发**,不按名字分支。这是 [Vision](vision.md) 的承重墙。逐能力的精确义务见[能力参考](../docs-site/zh/reference/capabilities.mdx)与[适配器契约](adapters/contract.md#能力从哪来构造证明不是问卷)。

**Integration tier** / **接入 Tier** —— 按「Adapter 接到哪里、额外拿到什么观测数据」给接入方式分的三档(和下面的**模型档**是两回事,后者说的是给 agent 指定哪个模型)。**Tier 1(只接 send)**:应用代码一行不改——adapter 适配应用现有对外接口实现 `send`,靠手写事件映射或官方转换器拿到工具断言;应用接口本身暴露模型选择的话,**模型对比**类 [Experiment](#experiment) 也在这一档(`model` 经 `ctx.model` 透传)。**Tier 2(send + OTel)**:还是同一个 `send`,事件来源换成应用发给 niceeval 的 OTel span(应用已埋点则零代码,未埋点补一段通用 OTel 初始化)——买到的是观测质量的跃升:事件流免手写映射、负断言带完整性证明、trace 瀑布图。**Tier 3(侵入改造 + experiment flags)**:改应用内部代码,把内部可变点(prompt、工具集、feature flag)暴露成 experiment 可选的配置(经 `flags` → `ctx.flags` 透传),解锁**完整的 feature A/B test**——对照的不再只是模型,而是应用内部的功能变体。前两档都是**无侵入**的:应用按自己的方式启动,eval 侧不 spawn 应用进程、不另开端口,Adapter 只对着用户前端本来就在用的那个接口收发。三档递进不互斥,详见 [docs-site · Tier](../docs-site/zh/concepts/tier.mdx)。

**Model tier** / **模型档** —— 给 agent 指定模型的标识(如 `opus`、`vendor/model?reasoningEffort=high`)。由 [Experiment](#experiment) 的 `model` 字段指定;省略则用 agent 原生默认,不经额外的策略层决定。

## 数据集与发现

**Dataset** / **数据集** —— 一组共享同一 `test` 逻辑、只有输入不同的 case。用 `loadYaml`/`loadJson` 读进来,`.map(row => defineEval(...))` 扇出。生成的 id 形如 `sql/0000`、`sql/0001`(零填充 4 位)。

**Discovery** / **发现** —— 运行器扫 `evals/` 找 `*.eval.ts` 文件,据路径推导 id 并排序。没有目录层面的隐式发现——沙箱型 eval 和会话型 eval 一样,必须有一个 `.eval.ts` 文件;起始文件靠 `test()` 里手工 `t.sandbox.writeFiles` / `uploadFiles` 放进沙箱(见 [Eval Authoring](eval-authoring.md#沙箱型手工把文件放进沙箱)),不靠运行器扫目录。

## 运行与结果

**Runner** / **运行器** —— 调度引擎。负责发现、有界并发执行、重试、早停、缓存,以及把结果交给报告器。详见 [Runner](runner.md)。

**Experiment** / **实验** —— 一份可签入的**运行配置**,描述「怎么跑这批 eval」:用哪个 [Agent](#agent)、跑几次、过滤哪些、预算多少。由 `defineExperiment` 定义在 `experiments/` 下,id 从路径推导。**一文件 = 一个单一配置**;**一个文件夹 = 一组要并排对比的实验**(`niceeval exp <组>` 跑整组),可比性由目录表达。它**不碰评分**——「怎么算对」是 eval 的事。详见 [Experiments](experiments.md)。

**Comparison group** / **可对比组** —— `experiments/` 下的一个文件夹,装一组"要并排比较"的单一配置(如同模型下 bub vs codex)。同组互为对照、`niceeval view` 并列展示;不同组是不同的对比维度。比文件内数组多表达了"可比性"语义。详见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验)。

**Run** —— 一次 `niceeval` 调用对一批 eval 的完整执行,产出一份 **summary**。

**Attempt** / **尝试** —— 同一个 eval 的第 i 次重复运行(`runs > 1` 时取通过率用)。这是 runner/result 的执行单位,不是 author-facing API 层。`t` 上的作用域断言会在一个 Attempt 的范围内聚合(全部 session + 全部 turn),不跨 Attempt、也不是上面 Run 那么大的范围。

**Session** —— 一条会话线。`t` 驱动主 session;`t.newSession()` 返回独立 session,用于并行或隔离的多会话测试。`session.*` 作用域断言只看这条 session 已经发生的事件;这些事件仍会汇入 `t.*` run 级断言。

**Turn** —— `t.send()` 的一次返回值,对应这一轮的标准事件流片段。带 `message` / `data` / `toolCalls` / `status` / `usage` / `events` 等只读字段,以及一套与 `t` 同名的作用域断言(`turn.calledTool`/`turn.succeeded`/…),作用域收窄成只看这一轮,详见 [Assertions](assertions.md#作用域规则)。

**EarlyExit** / **早停** —— 一个 eval 取通过率时,先过一次即中止其余 attempt 的策略(可关)。

**Fingerprint** / **指纹** —— `(eval 代码 + 配置)` 的哈希,用于缓存去重:指纹未变且已通过的,默认跳过。

**Transcript** —— agent 一次运行的逐事件记录。原始形态是各 agent 自己的 JSONL,被**归一化**成统一事件模型(message / tool_call / tool_result / thinking / error)后供断言和报告消费。详见 [Observability](observability.md)。

**o11y summary** —— 从**标准事件流**(见 [Observability](observability.md))派生的统计:工具调用计数、读/改的文件、shell 命令、web 请求、思考块数、**耗时、token 用量、估算成本**等。会注入沙箱(`__niceeval__/results.json`),让你在沙箱内手工跑的验证测试能断言 agent 的**行为**而不只是结果。

**Usage** / **用量** —— 一次运行的 token 计数(`inputTokens` / `outputTokens` / 可选 cache 读写)。随结果带回:remote agent 由 `send` 返回,沙箱型由 transcript 解析器从 agent 的 JSONL 抠出累加。可经 `t.usage` 读、`t.maxTokens()` 断言。

**Cost** / **成本** —— 用量经配置的价格表(模型 → 每百万 token 单价)换算的估算金额(`estimatedCostUSD`)。让跨 agent 对比从 pass-rate 升级为**质量 × 成本**。`--budget <usd>` 给整轮设上限。详见 [Observability](observability.md#用量与成本token--计费)。

**Reporter** / **报告器** —— 消费运行结果的插件,可实现分阶段 `onEvent`(`run:start` / `eval:start` / `eval:complete` / `run:summary` 等),也兼容 `onRunStart` / `onEvalComplete` / `onRunComplete`。内置控制台、JUnit、JSON;可接第三方实验跟踪平台。报告器在独立的串行队列上回调,不阻塞执行池。详见 [Reporters](observability.md#reporters)。

**Artifact** / **工件** —— 落盘的结构化产物,位于 `.niceeval/<时间戳>/`:run 级 `summary.json`,以及 attempt 级 `events.json`、`sources.json`、`trace.json`、`o11y.json`、`diff.json`。每个文件都是 JSON,不是 JSONL / NDJSON。详见 [Results Format](results-format.md)。

## 配置词汇

**`niceeval.config.ts`** —— 项目级配置,`defineConfig` 默认导出。完整字段:

| 字段 | 类型 | 作用 |
|---|---|---|
| `judge` | `JudgeConfig` | 默认评判模型(见 [Scoring](scoring.md#3-llm-as-judge)) |
| `reporters` | `Reporter[]` | 全局报告器(见 [Observability](observability.md#reporters)) |
| `maxConcurrency` | `number` | 并发上限(见 [Runner](runner.md#调度有界并发)) |
| `timeoutMs` | `number` | 单 eval 超时 |
| `sandbox` | `SandboxOption` | 项目默认 sandbox spec(`dockerSandbox()` 等工厂产出);experiment 可覆盖。两处都没设、又用了沙箱型 agent 时直接报错——没有隐式默认,也没有 `--sandbox` 这种 CLI 覆盖 |
| `pricing` | `Record<string, Price>` | 价格表覆盖,合并在内置快照之上(见 [Observability](observability.md#换算成本价格表从哪来)) |

agent 不在 config 里注册:每个 experiment 直接引用一个 agent adapter(见 [Experiments](experiments.md#defineexperiment-的形状))。config 只管项目级默认与全局资源。

**Strict mode** / **严格模式** —— 默认情况下 soft 断言低于阈值仍判 `passed`;`--strict` 下同样的情况改判 `failed`。用于 CI 把质量回归当成红灯。

**环境预置** —— niceeval 把准备逻辑放在普通代码里。要在跑 agent 前准备环境,放三处之一:这条 eval 的沙箱预置写在 `test(t)` 里(手工 `t.sandbox.writeFiles` / `runCommand`),连 agent / 装 CLI 写在 [`SandboxAgent.setup`](adapters/contract.md#agent-契约),整轮共享的外部服务(mock API、DB)用外部编排(`docker compose` / CI 脚本)起停、经 env 传入。详见 [Sandbox · 环境预置放哪](sandbox.md#环境预置放哪)。

## 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](eval-authoring.md) —— Eval / Task / Dataset 怎么写。
- [Scoring](scoring.md) —— Scorer / Assertion / Severity / Outcome 的完整手册。
