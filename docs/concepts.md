# Concepts

什么时候读这一篇:

- 你碰到一个不认识的 fasteval 术语;
- 你在写文档 / 代码,想跟现有用法保持一致;
- 你需要一页纸把整套词汇过一遍。

这是一份术语表。两个同义词并存时,**首选写法**用粗体。

## 评测核心词汇

**Eval** —— 评测的最小单元。一个 Eval = 一个 [Task](#task) 跑在一个 [Agent](#agent) 上,由若干 [Scorer](#scorer) 判分。统一由 `defineEval` 定义——会话型和沙箱型不是两个定义函数,`test(t)` 里 `t` 要不要带工作区能力,取决于引用的 [Agent](#agent) 声明的[能力位](#capability),不取决于用哪个 define 函数。每个 Eval 有一个从路径推导的 **id**。

**Task** —— 要让被测对象完成的"那件事"。不管会话型还是沙箱型,都是一串 `t.send(...)` 的输入——沙箱型只是 `t` 多了工作区能力,任务本身照样写在 `t.send(...)` 里。Task 描述意图,不描述如何判分。

**Agent** —— "一条连到 AI 的连接"的抽象,由 experiment 引用。按 transport 分三类:进程内(调你的函数)、远程(按你自己服务的协议)、沙箱(在 [Sandbox](#sandbox) 里 spawn coding agent 的 CLI)。运行器只认统一动词 `send`,核心按 Agent 的[能力](#capability)决定 `t` 上下文暴露哪些动作。fasteval 不定义任何 agent 协议,所以没有 `--url`、没有通用 http target —— 连你自己的服务也是写一个 agent,URL 是它的内部配置。详见 [Agents 与 Adapters](agents-and-adapters.md)。

**Scorer** / **评分器** —— 把"结果"映射成分数的东西。三类:**值级断言**(`expect` 里的 `includes`/`equals`/`matches`…,就地评估)、**作用域断言**(`t.succeeded()`/`t.calledTool()`…,在 `test` 结束后对整个 [Attempt](#运行与结果) 评估,同一套断言挂在 [Turn](#运行与结果) 上则收窄成只看这一轮)、**LLM-as-judge**(用一个评判模型给开放式回答打分)。沙箱型里,手工在沙箱内跑的验证测试(经 `t.sandbox.scriptPassed` 等断言判定)本身也是一种 Scorer。

**Assertion** / **断言** —— Scorer 的一次具体应用,带名字、严重级([gate / soft](#severity))、可选阈值,产出一个 0–1 的分数和过/挂。

**Outcome** / **判决** —— 一个 Eval 的评分结论,只有四态:`passed` / `failed` / `errored` / `skipped`。规则:显式 `t.skip(reason)` → `skipped`;执行出错(超时、异常、作者错误)→ `errored`;任一 gate 断言不过,或 `--strict` 下有 soft 断言低于阈值 → `failed`;否则 → `passed`。**没有 `scored` 这个中间态**——soft 断言没达标,在非 `--strict` 下就是 `passed`,分数照样如实记录、供横向对比,只是不影响这四态判定。`failed` 只表示断言/评分不通过,`errored` 是环境、超时、adapter、agent runtime 等执行问题,两者互斥,报告、JUnit、CI 都按这个口径分开统计,别把 `errored` 当成 agent 任务做错了。

**Severity** / **严重级** —— 断言的两档。**gate**:硬性要求,不过即判 `failed`,任何时候都生效。**soft**:质量分,不会单独让 eval 立即 `failed`——**没有 `.soft()` 方法**,`.atLeast(x)` 本身就是 soft:非 `--strict` 下低于阈值仍判 `passed`(分数如实记录),`--strict` 下才降级为 `failed`;不调 `.atLeast()` 时走匹配器自己的默认档(如 judge 默认 soft、无阈值,纯记分永不 fail)。

## 被测对象与适配器

**Adapter** / **适配器** —— 某个 [Agent](#agent) 的具体实现,**由用户编写**(fasteval 也内置几个常用 coding agent 的 adapter)。一个 Adapter 实现一个 Agent:进程内型直接调你的函数,远程型按你服务的协议发请求,沙箱型则拥有该 agent 的 CLI 参数、认证方式、默认模型、transcript 位置等全部特殊性。接新 agent = 加一个 Adapter,不动核心。同一个 agent 可有多个变体(如直连 API vs 经网关)。

**Sandbox** / **沙箱** —— 封装"在哪里、如何隔离地跑命令"的对象。统一接口:`runCommand` / `readFile` / `writeFiles` / `get|setWorkingDirectory` / `stop`。实现包括 Docker、Vercel Sandbox、其它三方。

**Backend** / **后端** —— 某个 Sandbox 的具体实现选择(`docker` / `vercel` / …)。`auto` 表示按环境探测(有云 token 用云,否则用 Docker)。

**Capability** / **能力** —— Agent / Adapter / Sandbox 通过一组能力位声明自己支持什么(会话、工具调用观测、文件 diff、transcript、桌面…)。核心**按能力分发**,不按名字分支。这是 [Vision](vision.md) 的承重墙。

**Model tier** / **模型档** —— 给 agent 指定模型的标识(如 `opus`、`vendor/model?reasoningEffort=high`)。由 [Experiment](#experiment) 的 `model` 字段指定;省略则用 agent 原生默认,不经额外的策略层决定。

## 数据集与发现

**Dataset** / **数据集** —— 一组共享同一 `test` 逻辑、只有输入不同的 case。用 `loadYaml`/`loadJson` 读进来,`.map(row => defineEval(...))` 扇出。生成的 id 形如 `sql/0000`、`sql/0001`(零填充 4 位)。

**Discovery** / **发现** —— 运行器扫 `evals/` 找 `*.eval.ts` 文件,据路径推导 id 并排序。没有目录层面的隐式发现——沙箱型 eval 和会话型 eval 一样,必须有一个 `.eval.ts` 文件;起始文件靠 `test()` 里手工 `t.sandbox.writeFiles`/`uploadFiles` 放进沙箱(见 [Eval Authoring](eval-authoring.md#沙箱型手工把文件放进沙箱)),不靠运行器扫目录。

## 运行与结果

**Runner** / **运行器** —— 调度引擎。负责发现、有界并发执行、重试、早停、缓存,以及把结果交给报告器。详见 [Runner](runner.md)。

**Experiment** / **实验** —— 一份可签入的**运行配置**,描述「怎么跑这批 eval」:用哪个 [Agent](#agent)、跑几次、过滤哪些、预算多少。由 `defineExperiment` 定义在 `experiments/` 下,id 从路径推导。**一文件 = 一个单一配置**;**一个文件夹 = 一组要并排对比的实验**(`fasteval exp <组>` 跑整组),可比性由目录表达。它**不碰评分**——「怎么算对」是 eval 的事。详见 [Experiments](experiments.md)。

**Comparison group** / **可对比组** —— `experiments/` 下的一个文件夹,装一组"要并排比较"的单一配置(如同模型下 bub vs codex)。同组互为对照、`fasteval view` 并列展示;不同组是不同的对比维度。比文件内数组多表达了"可比性"语义。详见 [实验怎么组织](experiments.md#实验怎么组织文件夹--一组可对比的实验)。

**Run** —— 一次 `fasteval` 调用对一批 eval 的完整执行,产出一份 **summary**。

**Attempt** / **尝试** —— 同一个 eval 的第 i 次重复运行(`runs > 1` 时取通过率用)。`t` 上的作用域断言就是在一个 Attempt 的范围内聚合(全部轮次 + `t.newSession()` 开的会话),不跨 Attempt、也不是上面 Run 那么大的范围。

**Turn** —— `t.send()` 的一次返回值,对应这一轮的标准事件流片段。带 `message` / `data` / `toolCalls` / `status` / `usage` 等只读字段,以及和 `t` 同名的一套作用域断言(`turn.calledTool`/`turn.succeeded`/…),作用域收窄成只看这一轮,详见 [Assertions](assertions.md#作用域两层同一套词汇)。

**EarlyExit** / **早停** —— 一个 eval 取通过率时,先过一次即中止其余 attempt 的策略(可关)。

**Fingerprint** / **指纹** —— `(eval 代码 + 配置)` 的哈希,用于缓存去重:指纹未变且已通过的,默认跳过。

**Transcript** —— agent 一次运行的逐事件记录。原始形态是各 agent 自己的 JSONL,被**归一化**成统一事件模型(message / tool_call / tool_result / thinking / error)后供断言和报告消费。详见 [Observability](observability.md)。

**o11y summary** —— 从**标准事件流**(见 [Observability](observability.md))派生的统计:工具调用计数、读/改的文件、shell 命令、web 请求、思考块数、**耗时、token 用量、估算成本**等。会注入沙箱(`__fasteval__/results.json`),让你在沙箱内手工跑的验证测试能断言 agent 的**行为**而不只是结果。

**Usage** / **用量** —— 一次运行的 token 计数(`inputTokens` / `outputTokens` / 可选 cache 读写)。随结果带回:进程内由 `send` 返回,沙箱型由 transcript 解析器从 agent 的 JSONL 抠出累加。可经 `t.usage` 读、`t.maxTokens()` 断言。

**Cost** / **成本** —— 用量经配置的价格表(模型 → 每百万 token 单价)换算的估算金额(`estimatedCostUSD`)。让跨 agent 对比从 pass-rate 升级为**质量 × 成本**。`--budget <usd>` 给整轮设上限。详见 [Observability](observability.md#用量与成本token--计费)。

**Reporter** / **报告器** —— 消费运行结果的插件,实现 `onRunStart` / `onEvalComplete` / `onRunComplete`。内置控制台、JUnit、JSON;可接第三方实验跟踪平台。报告器在独立的串行队列上回调,不阻塞执行池。详见 [Reporters](observability.md#reporters)。

**Artifact** / **工件** —— 落盘的结构化产物,位于 `.fasteval/<时间戳>/`:`summary.json`、逐 eval 的结果 JSON、事件流 ndjson、transcript、生成文件 diff、测试输出。

## 配置词汇

**`fasteval.config.ts`** —— 项目级配置,`defineConfig` 默认导出。设默认 judge 模型、全局 reporter、最大并发、超时、默认 sandbox 后端等。

**Strict mode** / **严格模式** —— 默认情况下 soft 断言低于阈值仍判 `passed`;`--strict` 下同样的情况改判 `failed`。用于 CI 把质量回归当成红灯。

**Setup hook** / **Teardown hook** —— 生命周期钩子的两个**阶段**动词。`setup` 在被测对象运行前预置环境(写 `.env`、装依赖、起服务),`teardown` 在跑完清理。`setup` 可返回一个 cleanup 闭包代替独立 `teardown`;`teardown` / cleanup 一律在 `finally` 跑,失败也跑。两者在每个作用域下成对出现(`hooks.run.setup`、`hooks.sandbox.teardown`…)。

**`hooks`** —— 收纳全部[生命周期钩子](lifecycle.md)的统一对象,**作用域是结构 key、动词统一为 `setup`/`teardown`**(无 `globalSetup` 这类特殊前缀):`hooks.run`(整轮一次,起停共享环境,产物经 `run.share()` → `ctx.shared` 传给各 attempt)、`hooks.sandbox`(每个 attempt 一次,预置/清理沙箱),`hooks.eval` 为预留扩展点。`defineConfig` 与 `defineExperiment` 同形,后者叠加在前者之上。

**Lifecycle** / **生命周期** —— 环境**起停**的分层模型,三个嵌套作用域:run、sandbox(每个 attempt)、backend(`Sandbox.create`/`stop`/`reset`)。用户钩子(`hooks.run` / `hooks.sandbox`)归 config(默认)与 experiment(叠加),**不进 eval**(eval 只管"测什么")。和 [reporter](#reporter--报告器) 正交:钩子管资源起停,reporter 管结果消费。详见 [Lifecycle](lifecycle.md)。

## 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](eval-authoring.md) —— Eval / Task / Dataset 怎么写。
- [Scoring](scoring.md) —— Scorer / Assertion / Severity / Outcome 的完整手册。
