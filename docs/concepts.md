# Concepts

什么时候读这一篇:

- 你碰到一个不认识的 niceeval 术语;
- 你在写文档 / 代码,想跟现有用法保持一致;
- 你需要一页纸把整套词汇过一遍。

这是一份按功能分组的术语表:每张表对齐中文写法、英文写法、一句话含义和唯一契约;
完整语义只写在契约列所链文档,不在本页重复展开。末尾的[禁用写法](#禁用写法)登记
已裁决不许再出现的词。两个同义词并存时,**首选写法**用粗体。

总表里的中文名和英文名都是正文首选写法。代码标识与标准术语不同时,英文列把代码标识放在
括号里,正文叙事使用标准术语,代码示例仍使用代码标识。

由具体功能产生的词条,契约列必须链接定义它的 Feature 契约。没有可链接 Feature 契约的概念
不进入总表;功能删除时同批删除对应词条。

## 术语总表

「中文」列是中文正文里的写法——很多词的首选写法就是英文原词,此时两列相同;有中文同义词的一并列出。「含义」只压到一句话,完整契约只看「契约」列所链文档。

### 产品

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| NiceEval | NiceEval | 产品名。正文写 `NiceEval`;命令、包名、配置文件、代码标识写 `niceeval` | 本页 |

### 评测用例

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 评测用例 | Eval | 一个 Task 跑在一个 Agent 上,由若干 Assertion 评判;id 从文件路径推导 | [Eval](feature/eval/README.md) |
| 任务 | Task | 要让被测对象完成的"那件事",写成一串 `t.send(...)`;只描述意图,不描述判分 | [Eval](feature/eval/README.md) |
| Fixture | Fixture | `test(t)` 显式写入的起始文件加 `EvalDef.setup` 准备的素材;算 eval 归因,不进 agent diff | [Eval architecture](feature/eval/architecture.md) |
| send 窗口 | send window | 一次 `t.send()` 从发出到返回的区间;Sandbox diff 只反映各窗口内改动的并集 | [Eval architecture](feature/eval/architecture.md) |
| 测试集 | Dataset | 共享同一 `test` 逻辑、只有输入不同的一组 case,`.map` 扇出,id 零填充编号 | [Dataset fan-out](feature/eval/use-case/dataset-fanout.md) |
| 发现 | Discovery | 扫 `evals/` 找 `*.eval.ts` / `*.eval.tsx` 并按路径推导 id;没有目录层面的隐式发现 | [Eval](feature/eval/README.md) |
| Attempt | Attempt | 同一个 eval 的第 i 次重复运行,也是范围断言的默认聚合范围 | [Eval context](feature/eval/library/context.md) |
| Session | Session | 一条会话线;`t.newSession()` 开独立 session | [Eval context](feature/eval/library/context.md) |
| Turn | Turn | `t.send()` 的一次返回值,带事件流片段和收窄到该 Turn 的范围断言 | [Eval context](feature/eval/library/context.md) |

### 评分与判定

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 断言 | Assertion | 对结果、行为、证据或资源使用提出的一项可记录检查;产出 0–1 分数或 `unavailable` | [Scoring](feature/scoring/README.md) |
| 判定 | Verdict | 一个 Eval 的四态评分判定:`passed` / `failed` / `errored` / `skipped` | [Severity 与 Verdict](feature/scoring/architecture/severity-and-verdict.md) |
| 严重度 | Severity | gate 不过即 `failed`;soft 默认不改判定,`--strict` 下才计入 | [Severity 与 Verdict](feature/scoring/architecture/severity-and-verdict.md) |
| Judge 断言 | LLM-judged assertion | 把材料和 rubric 交给裁判模型求分的 Assertion;默认 soft、无阈值 | [LLM-as-a-judge](feature/scoring/library/judge.md) |
| 断言范围 | Assertion scope | `t.*` 看 Attempt、`session.*` 看 Session、`turn.*` 看 Turn 已发生的事件 | [Scopes](feature/scoring/architecture/scopes.md) |

### 计分粒度

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 计分方式 | Scoring scheme | `defineEval` 把整题折叠成一分;`defineScoreEval` 在题内叠加计分项、不声明满分 | [计分粒度](feature/experiments/score-points.md) |
| 计分项 | Scoring criterion | `.points(n)` 让断言贡献分数;`t.score(label, n)` 是直接计分出口 | [计分粒度](feature/experiments/score-points.md) |

### Agent 与 Adapter

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Agent | Agent | 「一条连到 AI 的连接」的抽象;`kind` 只有 `"remote"` 和 `"sandbox"` | [Adapters](feature/adapters/README.md) |
| 适配器 | Adapter | Agent 的具体实现;拥有协议、认证、CLI 参数与 transcript 位置等特殊性 | [Adapters](feature/adapters/README.md) |
| `send` | `send` | 运行器认得的统一动词;协议、事件映射与会话续接都由 Adapter 实现 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| 能力 | Capability | `t` 暴露哪些动作由 `send` 的构造证据决定,不是声明式能力位 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| 接入等级 | Integration tier | Tier 1 只接 `send`,Tier 2 再接 OTel,Tier 3 再暴露实验 flags | [Adapters](feature/adapters/README.md) |
| 无侵入 | Non-intrusive | Tier 1 / Tier 2 不由 eval spawn 应用进程或另开端口;不写 `黑盒` | [Adapters](feature/adapters/README.md) |
| 人工介入 | HITL(human-in-the-loop) | agent 等待人工输入;`waiting` + `input.requested` 构成能力证据 | [Sessions 与 HITL](feature/adapters/library/sessions-and-hitl.md) |

### Sandbox

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Sandbox | Sandbox | 封装「在哪里、如何隔离地跑命令」的对象 | [Sandbox](feature/sandbox/README.md) |
| Provider | Provider | Sandbox 的具体实现选择,由内置或自定义工厂显式构造 | [Sandbox library](feature/sandbox/library.md) |
| 工作目录 | workdir | Sandbox 内 agent 的默认工作目录,也是变更分类账与 agent diff 的锚点 | [Sandbox library](feature/sandbox/library.md) |
| `t.sandbox` | `t.sandbox` | 沙箱型 eval 的文件 IO、命令执行、断言与 diff 接口 | [Sandbox operations](feature/sandbox/library/operations.md) |
| 变更分类账 | Change ledger | runner 私有的 git 分类账;只把锚点之后的改动放进 agent 归因视图 | [Sandbox architecture](feature/sandbox/architecture.md) |

### Sandbox 复用

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 预制环境 | Prebuilt environment | 把稳定依赖做进 image、template 或 snapshot，供全新 Sandbox 直接使用 | [Prebuilt environments](feature/sandbox/library/prebuilt-environments.md) |
| Sandbox 预热 | Sandbox prewarming | 计划确定后提前创建即将使用的全新 Sandbox，不改变每 Attempt 的生命周期 | [Runner](runner.md) |
| Sandbox 复用 | Sandbox reuse | Experiment 用 `sandboxReuse: true` 声明多条 Attempt 可以共用 Sandbox | [Sandbox reuse](feature/sandbox/reuse.md) |
| 复用 Sandbox 的题间重置点 | Between-eval reset point for Sandbox reuse | SandboxSpec `setup` 后落下的 commit；共用同一 Sandbox 的 Attempt 之间重置回这里 | [Sandbox reuse](feature/sandbox/reuse.md) |
| Sandbox 复用寿命 | Sandbox reuse lifetime | Provider 能保证一个 Sandbox 继续运行的剩余时间，由 `ensureLifetime` 确认或续期 | [Sandbox reuse](feature/sandbox/reuse.md) |
| 收尾预留时间 | Cleanup reserve | 在 Attempt deadline 之外为 Hook 收尾与 Sandbox 销毁保留的内部安全时间 | [Sandbox reuse](feature/sandbox/reuse.md) |

### 实验配置

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 实验 | Experiment | 可签入的运行配置:Agent、model、flags、运行次数与预算;不碰评分 | [Experiments](feature/experiments/README.md) |
| 实验 flags | Flags | A/B 条件键,经 `ctx.flags` 给 Adapter、`t.flags` 给 eval | [Flags、labels 与 facts](feature/experiments/use-case/实验值归属/) |
| 实验 labels | Labels | 只供报告分组的坐标;不透传、不参与可比性配置 | [Flags、labels 与 facts](feature/experiments/use-case/实验值归属/) |
| 运行时观测 | Runtime observation (`facts`) | 运行时才知道、由 `ctx.fact()` 主动上报并随结果保存的值;不进配置或指纹 | [Flags、labels 与 facts](feature/experiments/use-case/实验值归属/) |
| 模型(`model` 字段) | Model | Experiment 为 agent 指定的模型标识;省略则用 agent 原生默认 | [Experiments](feature/experiments/library.md) |
| 推理强度 | Reasoning effort (`reasoningEffort`) | 独立于 `model` 的推理强度档位;归属与 `model` 一致 | [Experiments](feature/experiments/library.md) |
| 首过即停 | EarlyExit | 一个 eval 先过一次即中止其余 Attempt 的策略;配置名 `earlyExit` | [Early exit](feature/experiments/use-case/首过即停.md) |

### 预算护栏

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 实验预算上限 | Per-experiment budget limit | 每个 Experiment 独立计账和封顶,不是 Invocation 的共享总预算 | [Budget](feature/experiments/use-case/预算上限.md) |

### Runner 调度

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 运行器 | Runner | 负责发现、有界并发、重试、缓存与结果交付的调度引擎 | [Runner](runner.md) |
| 生命周期 Hook | Hook | 实验、Sandbox、eval、agent 四层共用的成对 `setup` / `teardown` 回调 | [Runner](runner.md) |
| Invocation | Invocation | 一次 CLI 调用的瞬时编排边界;可调度多个 Experiment,不是持久化实体 | [Runner](runner.md) |
| 派发 | Dispatch | 把一个 Attempt 交出去开始执行;排队等待不算派发,停止派发不抢占在飞项 | [Runner](runner.md) |
| 并发位 | Concurrency slot | 全局 `maxConcurrency` 的一个名额,只在 Attempt 真正执行时占用 | [Runner](runner.md) |
| 实验并发限制 | Experiment concurrency limit | `ExperimentDef.maxConcurrency` 对同一实验的跨 Invocation 并发限制 | [Max concurrency](feature/experiments/use-case/并发/限制全局并发.md) |
| 有效宽度 | Effective width | 全局并发位和实验并发限制共同允许的同时执行数 | [Runner](runner.md) |
| 调度波次 | Scheduling waves | `ceil(Attempt 数 / 有效宽度)`;波次多的 Run 优先拿并发位 | [Runner](runner.md) |
| 完成状态 | CompletionStatus | 独立于 Verdict 的 `complete` / `incomplete` / `interrupted` 结论 | [Runner](runner.md) |

### 执行失败分类

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 致命错误熔断 | Fatal-error circuit breaker | 作者声明失败范围;一次命中即停止对应 Eval 或 Experiment 的后续派发 | [Error classification](feature/error-classification/README.md) |
| fail-fast | fail-fast | 无声明时按预检或同一 error code 连续复现保守停止派发 | [Runner](runner.md) |

### 超时与耗时读数

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 超时 | Timeout | Adapter 内层超时加 Runner 外层 Attempt deadline;排队不计入 | [Runner](runner.md) |
| 总耗时 | Elapsed time | 一次 Invocation 从开始到结束经过的时间，包含并行重叠和排队 | [Runner](runner.md) |
| 阶段耗时 | Phase duration | 一个生命周期阶段实际经过的时间，由 Attempt 时间树记录 | [Benchmark](engineering/benchmark/README.md) |
| 超时样本的耗时下界 | Duration lower bound for timed-out samples | 超时时只知道真实耗时大于超时线;统计上称为右删失 | [Measures](feature/reports/library/measures.md) |

### 缓存与结果沿用

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 指纹 | Fingerprint | `(eval 源码闭包 + 配置)` 的哈希;未变且判定确定的结果默认沿用 | [Cache](feature/experiments/cache.md) |
| 结果沿用 | Result carry-forward | 合格的历史 Attempt 直接并入本次 Run、不重跑 | [Cache](feature/experiments/cache.md) |
| 配置哈希 | `configHash` | 指纹的 Run 级配置层,同时担保跨 Run 可比 | [Cache](feature/experiments/cache.md) |
| 用例锁 | Eval lock | 按 `(experimentId, evalId)` 取的派发租约,避免并行 Invocation 重复执行 | [Experiments architecture](feature/experiments/architecture.md) |

### Observability

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Transcript | Transcript | Agent 一次运行的逐事件原始记录,归一化后供消费 | [Events](feature/adapters/architecture/events.md) |
| 标准事件流 | StreamEvent / events | Transcript 或 `send` 返回归一化成的统一事件模型 | [Events](feature/adapters/architecture/events.md) |
| o11y 摘要 | o11y summary | 从标准事件流可重算的行为计数,注入 Sandbox 供行为断言 | [Observability](observability.md) |
| trace 瀑布图 | Trace waterfall | OTLP span 画出的统一时间轨 | [Observability](observability.md) |
| Agent 执行树 | Agent execution tree (`ExecutionTree`) | 事件骨架与可关联 OTel span 合成的统一执行记录 | [Execution view](feature/reports/show/execution.md) |
| 用量 | Usage | 一次运行的 token 计数 | [Observability](observability.md) |
| 成本 | Cost | 用量经价格表换算的估算金额 `estimatedCostUSD` | [Observability](observability.md) |
| 报告器 | Reporter | 运行中流式消费结果的插件;与运行后的 Report 不同 | [Observability](observability.md) |

### 结果记录

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| artifact | Artifact | Run 目录里的 `run.json`、Attempt `result.json` 与证据文件 | [Record](feature/record/architecture.md) |
| 诊断 | Diagnostic | 不改判定的操作性事实,按 Attempt 或 Run 归属落盘 | [Record](feature/record/architecture.md) |
| 生命周期阶段 | `LifecyclePhase` | 结构化错误与诊断使用的封闭阶段词表 | [Record](feature/record/architecture.md) |
| 记录根 | Record root | 结果目录树的根,默认 `.niceeval/` | [Record library](feature/record/library.md) |
| 记录 | Record | `openRecord()` 打开记录根得到的事实层句柄,一点判断都不许有 | [Record library](feature/record/library.md) |
| 结果 Run | Run | 一个 Experiment 的一次持久化执行水位,可由多次 Invocation 续成 | [Record](feature/record/architecture.md) |
| Attempt 定位符 | AttemptLocator | `@` 前缀的稳定短引用,不是数组下标或目录路径 | [Record](feature/record/architecture.md) |

### 样本选择

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Sample(样本) | Sample | 挑好的 Attempt、覆盖事实与结构化挑选警告;`pipe` 只删减 | [Sample](feature/sample/README.md) |

### 报告

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Attempt 证据 | AttemptEvidence | 每个 Attempt 只装配一次的中性证据聚合,四个消费面共用 | [Reports architecture](feature/reports/architecture.md) |
| 标注 Eval 源码 | AnnotatedEvalSource | 一个 Attempt 的完整源码调用树；主干、调用片段与未映射记录共用一份面无关证据 | [Eval source](feature/reports/eval-source/README.md) |
| 读数 | Measure | 一个 Attempt 算出一个值,再按题和组两级聚合;缺数据为 `null` | [Measures](feature/reports/library/measures.md) |
| 维度 | Dimension | 决定 Attempt 分到哪一组的分组键 | [Measures](feature/reports/library/measures.md) |
| 报告 | Report | `defineReport` 的产物,也是 `--report` 装载的单位 | [Reports](feature/reports/README.md) |
| 页 | Page | 报告内带 `id`、`title` 与 `content` 的寻址和导航单位 | [Report shell](feature/reports/library/shell.md) |
| 原语 | Primitive | 只负责一种稳定 Content 形状、不认识 NiceEval 领域对象，并提供 text / web 两面 | [Report components](feature/reports/components/README.md) |
| 数据源 | Data source | 把 Sample、Run 或 AttemptEvidence 计算成某个原语可消费的可序列化 Content | [Report components](feature/reports/components/README.md) |
| 组合组件 | Composition component | 只装配原语与数据源、不自行实现渲染面的组件 | [Report components](feature/reports/components/README.md) |
| 宿主 | Host | 打开结果、选择 Sample 并渲染 Report 的 show 或 view | [Reports architecture](feature/reports/architecture.md) |
| 有效根 | Effective root | 记录根经位置参数或 `--exp` 收窄后的部分 | [View](feature/reports/view.md) |
| 持续重建 | Continuous rebuild | `niceeval view` 监听输入变化并重跑整条建站管线 | [View](feature/reports/view.md) |
| 默认报告 | —(角色名,非 API) | 不传 `--report` 时 show / view 装载的内建普通 Report | [Default report](feature/reports/show/default-report.md) |
| 报告槽位 | Report slot(内部代号) | 宿主中可被 `--report` 整体替换的部分 | [Reports architecture](feature/reports/architecture.md) |

### 报告组件

公开面按角色分成原语、数据源与组合组件。原语名描述稳定形状,数据源名描述算出的 Content,
组合组件名描述读者得到的完整区块。

| 角色 | API | 回答或呈现什么 | 契约 |
|---|---|---|---|
| 原语 | `Table` / `Grid` / `Callouts` / `Waterfall` | 表格、读数网格、提示组与时间树 | [Components](feature/reports/components/README.md) |
| 图表原语与数据源 | `Chart` + `chart(...)` | 折线、柱、面积、散点或混合 mark 的坐标系 | [Charts](feature/reports/components/charts/README.md) |
| 实体数据源 | `experimentRows` / `evalRows` / `attemptRows` | 以对应实体为顶层的层级行 | [Sources](feature/reports/components/sources/README.md) |
| 读数数据源 | `measureRows(...)` / `measureMatrix(...)` | 一个维度的读数行或两个维度的交叉格 | [Sources](feature/reports/components/sources/README.md) |
| 专用数据源 | `scoreboard(...)` / `deltaRows(...)` / `stabilityRows(...)` | 固定题集成绩、成对差异与历史稳定性 | [Sources](feature/reports/components/sources/README.md) |
| 摘要数据源 | `sampleSummary(...)` | Sample 的范围、数量、判定构成与主读数 | [Summary](feature/reports/components/summaries/sample-summary.md) |
| 证据数据源 | `attemptSummary` / `attemptTimeline` / `attemptDiff` 等 | AttemptEvidence 的各类可呈现投影 | [Attempt detail](feature/reports/components/attempt-detail/README.md) |
| 组合组件 | `SampleOverview` | 当前 Sample 的默认总览 | [Overview](feature/reports/components/summaries/sample-overview.md) |
| 组合组件 | `AttemptDetail` / `FailureList` | Attempt 完整证据或当前失败集合 | [Components](feature/reports/components/README.md) |

### 配置与 CLI

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 严格模式 | Strict mode | `--strict` 下 soft 断言低于阈值改判 `failed`,用于 CI 把质量回归当红灯 | [Scoring CLI](feature/scoring/cli.md) |
| 环境预置 | —(用普通代码表达) | 跑 agent 前的准备逻辑,三个家:eval 内 `t.sandbox.*`、`SandboxAgent.setup`、外部编排 | [Sandbox library](feature/sandbox/library.md) |
| CLI flag | CLI flag | 命令行开关(`--strict`、`--report`…);写作时一律带「CLI」限定或写字面 `--xxx`,不与实验 flags 混用 | [CLI](cli.md) |

## 禁用写法

已裁决不许出现在 `docs/` 正文里的写法登记在
[`writing-rules.json`](writing-rules.json) 的 `bannedTerms` 里,不写成表格——
这份清单的用途是被脚本读:一条记录带 `term` / `use` / `why` 三个字段,
`pnpm test:docs` 命中时原样打印 `use` 和 `why`,改的人不必回来翻文档。

裁决一个新术语时同批往那份 JSON 加一条:`why` 写清为什么这个词会误导读者,不写"统一一下"。
扫描规则、句长段长行宽的台账与收紧办法见 [`docs/README.md` · 校验与同步](README.md#校验与同步)。

## 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](feature/eval/README.md) —— Eval / Task / Dataset 怎么写。
- [Scoring](feature/scoring/README.md) —— Assertion / Severity / Verdict 的完整手册。
