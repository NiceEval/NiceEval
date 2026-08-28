# Inspection CLI

## `niceeval query`

```sh
niceeval query discover
niceeval query explain [--record <RecordSnapshot>] --request <file|->
niceeval query run [--record <RecordSnapshot>] --request <file|->
```

`query` 是 machine 入口：它只以 `niceeval.query/v1` 输出结构化结果，不接受 human 输出模式。每份 stdout
document 都显式包含 `outcome: discovery | success | explanation | failure`。
人在终端中审阅同一批固定 operation 时使用下文的 `niceeval show`；浏览器体验仍由
[Insight](../insight/README.md) 的 `niceeval view` 提供。

`discover` 是静态 catalog，不接受 `--record`，也不打开 source。它输出 `outcome: discovery` 的 compact bootstrap。
每个 operation 都带 schema、合法 selector、错误 union 与最小 follow-up request。

`explain` 与 `run` 才读取完整 request，由 source adapter 打开 facts。前者先交付将读取的 source、selection、
comparison mode 与 fact kinds，避免调用方先取重 payload。后者以 `outcome: success` 交付闭合 protocol result。
协议级失败使用 `outcome: failure`，不借字段缺席模拟另一种 shape。

## 默认 Overview

AI 要先回答“有哪些 Experiment、各 Eval 的通过率／分数怎样、哪条 Attempt 值得下钻”时，只运行
一个 `overview.get`，不先枚举 Run 再自行聚合：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "overview.get" }
}
```

`overview` 先按 `experimentId + evalId + attemptOrdinal` 对齐逻辑 slot，再选择每个 slot 的最新
sealed occurrence；`completedAt`、`startedAt` 与 `runId` 依次打破平局。旧 occurrence 仍可由 Run operation
读取，但不重复进入默认 Overview 分母。结果保留 experiment、Eval 路径 group、Eval、Attempt ordinal、
selected Run、target Slot、membership action、origin/reference relation 与 locator。

每个 `experimentId + evalId` cell 同时交付 `pass | points | mixed` evaluation kind。
它还交付 expected／observed／classified／missing denominator、四态 Verdict tally、pass rate、points score、
coverage 与 issues。
顶层 totals、Experiment totals 与路径 group totals 由同一批 selected cell 折叠。调用方不得从 locator 数、历史 Run、
最后一条 Attempt 或单独的 score 值重新计算另一套结果。

pass rate 使用已分类 Attempt 作为业务分母；`skipped` 计入分母但不计入 numerator。结果仍显式保留
expected、observed、classified 与 missing，缺失不会被伪装成失败或从完整度中消失。Score 聚合已封存的
earned／possible，不把分数换算成 Pass。

pass rate 与 points 都使用闭合 `MetricValue`：`value`、`state`、`samples`、`total`、`basis`、`issues` 与
Attempt `refs` 始终一起交付。状态穷尽为 `available | partial | unavailable | empty | unsupported | failed`。

有值但样本范围不全是 `partial`；有合格 slot 却没有可形成的值是 `unavailable`；没有合格 slot 是 `empty`。
producer/family 无此能力是 `unsupported`；已选择事实无法解释是 `failed`。points 的 `value` 是 earned，
`bounds.max` 是 possible；consumer 不从 Assertion 或其它 scalar 重算它。

`overview.cells[].members[].score.value` 是一个 selected Attempt 的 earned 真值。
`overview.cells[].score.value` 是同一 Experiment × Eval 中 eligible Attempt score 的 mean。

`overview.experiments[].score.value` 是可见 per-Eval cell score 的 sum。路径 group 与顶层 totals 从 cell score
折叠。member 与 cell score 的 `basis` 是 `slot`；Experiment、group 与 totals score 的 `basis` 是 `eval`，
其 `samples`／`total` 计 contributing／eligible per-Eval cell。所有值都保留 `MetricValue` state、issues 与 refs。

`mixed` cell 的 pass members 不进入 points 的 `samples` 或 `total`。`totalScore` 不存在，不能成为第二权威字段。

Insight Overview 调用同一个 `overview.get` result meaning，并只负责默认 Experiment 选择、表格、链接、
折叠与本地化。它不是另一套 Overview 数据源。`query` 只编码 machine document，下文的 `show` 才拥有固定终端排版。

## 从 Attempt outline 下钻到一项详情

`attempt.get` 是 Attempt 首页：它交付身份、Verdict、score、Assertion Evidence、coverage 与 limitations。
它列出 Assertion `entryId`／display，并逐项声明 section 状态。section 包括 assertions、trace、sources、diff、
artifacts、timing、usage、commands 与 diagnostics，状态为 `available | not-recorded | partial | unavailable`。
需要看一项 Assertion 的完整调试依据时按稳定 `entryId` 请求：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": {
    "kind": "attempt.assertion.detail",
    "locator": "@<locator>",
    "entryId": "assertion_<stable-id>"
  }
}
```

detail 保留完整已封存 Assertion entry、display 与 source sites，并另给规范化 `check`。
check 与每个 diagnostic node 都明确包含 `label`、`state`、`expected`、`observed`、`reason`、`anchor` 与有序
`children`。缺席字段为 `null`，不能由 View 猜测。

collection matcher 另交付 comparator、receipt、result、retained targets 与完整 `debugger`。

debugger 的 `source.atEvaluation` 固定评估时 snapshot cut。`source.final` 固定 Attempt 封口后的同 scope
ledger。

每行交付 detail、evaluation、locator 与 exact/unavailable conversation target。cut 后新增行标为
`outside-snapshot`。
它还交付 identity proof、overlay retention、source limitations 与 ordered matcher steps。

只有以下证据全部一致时，identity 才是 `exact`：

- sealed Agent Turns；
- snapshot；
- retained overlay；
- ordered path；
- receipt row count。

否则结果明确返回 `source-unavailable` 或 `ambiguous`。target anchor 直接使用同一 Record 的
`toolOccurrenceId` 或 `eventId`。

source/field state 也是结果事实，View 只把它们映射到 `data-source-state`／`data-field-state`。

当前 Record 没有 `toolOccurrenceId` 到 Sandbox `commandId` 的持久 join。command matcher detail 因而只能
交付已封存 logical-command comparator、lifecycle 与 tool input/output；对应 Sandbox command join 明示
`unavailable/not-recorded`，不能按文本或顺序猜配。Sandbox command 的 invocation、exit、stdout 与 stderr
仍只按其自身 `commandId` 经 `attempt.trace.detail` 读取。

需要看 execution 时，先取得有界 outline：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "attempt.trace", "locator": "@<locator>" }
}
```

outline 按 Turn 保留 message、thinking、tool call/result，并另外列出 command、timing、usage 与 diagnostic。
长文本只给有界 preview；独立 identity index 枚举这次 Attempt 已封存的全部 `itemId`、精确
`toolOccurrenceId` 与 `commandId`，所以 preview 之外的项仍可选择。调用方需要一项完整详情时，使用其中
一个 identity：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": {
    "kind": "attempt.trace.detail",
    "locator": "@<locator>",
    "selector": {
      "kind": "tool-occurrence",
      "toolOccurrenceId": "tool_<stable-id>"
    }
  }
}
```

`selector.kind` 穷尽为 `item`、`tool-occurrence` 与 `command`，分别使用 `itemId`、
`toolOccurrenceId` 与 `commandId`。tool occurrence detail 把同一 occurrence 的 call 与 result 一起交付；
command detail 交付 invocation、outcome 与已封存 stdout/stderr。identity 未命中时返回
`inspection-selection-missing`，不会猜相邻项。

Query 不接受旧 `t<N>.c<M>`、`cmd<N>` 或其它按显示位置派生的 handle。详情中的“完整”只表示完整取回
已经脱敏并按 Record family 上限封口的内容；producer 已写入的 truncation 与 limitations 必须继续可见，
查询不能恢复运行时已经舍弃的原文。只有声明权威总量的 command stream 同时交付 retained bytes 与
`totalSafeUtf8Bytes`；conversation text 只交付已封存值及其 limitation，不能虚构运行时原文总量。

`--record` 只选择由 `niceeval record snapshot --output` 产生的 sealed-only
`RecordSnapshot`。未给它时，Node source adapter 打开 project operational Store 的 sealed cutoff；普通
SQLite copy、checkpoint 或任意外部文件不是 `--record` 输入。

CLI 只在 Node 中运行：它以 `node:sqlite` source adapter 对 live Record 或指定 `RecordSnapshot` 打开 facts，
然后调用内部 Inspection selector。它不启动 HTTP、sqlite-wasm、浏览器、View session 或
额外 Snapshot；`--record` 也不会生成 query 专用的 projection 或 artifact。

`--record` 与 request 的职责正交。前者选择已验证的 SQLite source；后者在固定 operation 的
参数边界内选择 Overview、Run、Attempt、精确 trace identity 或比较集合。命令不接受 SQL、`where`、
JSON path、formula、数据库 cursor、rowid、文件位置或调用方指定的 page size。

machine consumer 需要原始 Run 层级或既有摘要时仍可使用 `run.get` 与 `run.summary`。需要一份与人读
Run 概览相同的闭合 machine result 时使用新增的 `run.overview`：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "run.overview", "runId": "run_01JSHOW" }
}
```

`run.overview` 按 exact `runId` 一次交付：

- Run/Experiment identity 与时间；
- expected/observed denominator 和 Member state/locator/origin relation；
- Verdict、score、coverage、usage 状态与摘要，以及 limitations。

Run 已命中但 expected Member 未观测时，result 保留 `missing` Member 与不相等的 denominator。
partial、not-recorded 或 unavailable 的 score、coverage、usage 不按失败或零补齐。
这个 result 从 pinned facts 即时形成，不会作为 SQLite 派生表、缓存、Show DTO 或其它 artifact 持久化。

## machine 输出与错误面

`query` 的 protocol 是 `niceeval.query/v1`。每次可形成协议输出的调用都恰好向 stdout 写一个 canonical
`InspectionDocument`。其 `outcome` 穷尽为 `discovery | success | explanation | failure`。
success 编码 operation result，并带 `behaviorVersion`、source、sealed cutoff、selection、limits、issues 与 Evidence。
explanation 交付同一 operation 的读取范围与 fact kinds。failure 交付 code、reason 与 correction。

每个 source-bound success/explanation document 的 `source` 固定为
`{ kind: facts.kind, sealedCutoffIdentity: facts.cutoff().identity }`。
它不含路径，`runCount` 只在 `sealedCutoff` 中出现。codec 的 allowed/required fields、base envelope 与
`runs.list` envelope 都使用这一字段。

这个 protocol document 只属于 CLI 编码边界，不是 Insight 输入、View DTO、缓存或第二份持久
artifact。CLI、Web 与 Testkit 都从 `niceeval/inspection` 取得同一 Schema、类型与 decoder。Testkit 只在完整
decode `InspectionDocument` 后按 `outcome` 和 operation 语义窄化，不维护宽松 JSON shape。浏览器直接在完整
`RecordSnapshot` 上运行相同 operation、参数校验、row codec 与 result
meaning；它不请求或反序列化 `query` stdout。

进度、argv 错误、无法读取 request、无法验证 source，以及无法形成 document 的进程失败只写
stderr 并以非零状态退出。调用方不能根据 stderr 拼接部分 JSON，也不能把 stdout 的 document
与另一 source 或 cutoff 的页混合。

continuation token 绑定 operation、canonical request、source identity 与 sealed cutoff。绑定
改变时，`query` 在 canonical document 中返回 restart correction；调用方必须从新的
discovery 或 request 重新开始。

## `niceeval show`

```sh
niceeval show [--record <RecordSnapshot>]
niceeval show --run <run-id>... [--record <RecordSnapshot>]
niceeval show --experiment <experiment-id>... [--record <RecordSnapshot>]
niceeval show @<locator> [--record <RecordSnapshot>]
niceeval show @<locator> --source [--record <RecordSnapshot>]
niceeval show @<locator> --execution [--expand <stable-id>] [--record <RecordSnapshot>]
niceeval show @<locator> --timing [--record <RecordSnapshot>]
niceeval show @<locator> --usage [--record <RecordSnapshot>]
niceeval show @<locator> --diff [--record <RecordSnapshot>]
```

`show` 是英文 human text 入口。它不调用 `query` stdout 或解码 `niceeval.query/v1`，而是与
`query` 一样打开 Node facts adapter，调用具名 Inspection operation，再格式化其闭合 result。

show 的每个投影只接受对应具名 operation 的 typed result；必填 shape 缺失时失败，只有契约
明示的 `null`、optional、`not-recorded` 或 `partial` 才能显示业务 fallback。

renderer 只能决定稳定顺序、终端宽度和文字布局。它不得重选成员，也不得重算
denominator、pass rate、score、coverage、usage、timing、diff 或 Evidence。宽度不足时可折行或截断已声明的 preview，
但不能改变成员、数值、状态或 omitted 数量。

### 固定投影

- 无 selector 时调用 `overview.get`，格式化 totals、Experiment summaries 以及
  Experiment → Eval → Attempt table。Experiment ID 含 `/` 时，首段形成显示分组，组内 Experiment 与同前缀
  Eval 使用相对标签；每个 Experiment 小节仍显示一次完整 ID，每个可下钻 Attempt 显示完整稳定 locator。
  Attempt 表只保留 `Eval`、`Attempt` 与 `Score`，不显示 membership action 或 origin/reference relation。这些 provenance
  仍由具名 operation 保留并可在 Run/Attempt 下钻中查看。
- 一个或多个 `--experiment` 逐个调用 exact `experiment.get`，格式化指定 Experiment 的 aggregate、Eval cells 和 Attempt locators。
  CLI 不得调用 `overview.get` 后按 `experimentId` 过滤。
- 一个或多个 `--run` 逐个调用 exact `run.overview`，并且只消费这一份闭合 result。
  它显示指定 Run 的 identity、时间、denominator、Member/Attempt locators、Verdict、score、coverage、usage 与 limitations。
  CLI 不得组合 `run.get` 与 `run.summary`。重复 flag 的输入顺序不是业务排序 authority。
- `@<locator>` 默认调用 `attempt.get`，显示精确身份、Verdict、score、coverage、Assertion
  摘要、section states 与 limitations，并给出可复制的 source、execution、timing、usage 和 diff 后续命令。
- `@<locator> --source` 调用 `attempt.sources`，显示已封存 source 与 Assertion facts，保留
  source state、location、limitations 与 Evidence；不从文本推断断言或运行时原文。
- `@<locator> --execution` 调用 `attempt.trace` 显示有界 outline。`--expand <stable-id>`
  必须和 `--execution` 一起使用，且只接受 outline identity index 已暴露的 `itemId`、
  `toolOccurrenceId` 或 `commandId`；命中后以对应 selector 调用 `attempt.trace.detail`。
  旧 `t<N>.c<M>`、`cmd<N>`、数组位置或任意未暴露 ID 一律是 selection error，不猜测相邻项。
- `@<locator> --timing` 调用 `attempt.timing`，显示 activity 层级、phase、offset、duration、outcome、limitations 与 omitted count。
- `@<locator> --usage` 调用 `attempt.usage`，只显示其关闭的 input/output token、request 与 cost typed totals，以及每项 total 的 state/coverage。renderer 不得从 observations 聚合 totals，也不得将缺失或 omitted 按零补齐。
- `@<locator> --diff` 调用 `attempt.diff`，显示已封存 window 与 file changes，并保留 binary、oversized、capture failure 等边界。

### selector 与 flag 组合

`@<locator>`、`--run` 与 `--experiment` 是三种互斥 selector。`--run` 与 `--experiment` 可各自重复，
重复值去重后由 Inspection 逐个 exact 选择。所有 selector 必须在同一 sealed cutoff 上命中，命令才输出任何 section。

`--source`、`--execution`、`--timing`、`--usage` 与 `--diff` 都要求一个 Attempt locator，且五者互斥。
`--expand` 只能与 `--execution` 同用。`--record` 与上述所有 selector 正交，它只选 source。

### 默认 Overview 示例

human renderer 将 pass rate 显示为百分比。`available` 是健康 metric 的默认状态，不附加在数值后；
`partial`、`unavailable`、`empty`、`unsupported` 与 `failed` 仍须明确显示。Experiment summary 按路径首段分组，
Attempt 明细再按完整 Experiment 分表，使 80 列终端可以在同一行保留完整 locator：

```text
$ niceeval show
NiceEval results
  Totals

  Observed   5/5
  Verdicts   5 passed
  Pass rate  100%
  Score      74

Experiments
  harness
  Experiment  Observed  Pass rate  Score
  ----------  --------  ---------  -----
  canary      3/3       100%       32
  v0.12.0     2/2       100%       32

  install
  Experiment  Observed  Pass rate  Score
  ----------  --------  ---------  -----
  canary      2/2       100%       10

Attempts · harness
  Experiment harness/canary
  Eval              Attempt         Score
  ----------------  --------------  -----
  terminal-install  @1M9Y03P6DXYQ   16
  terminal-init     @1MYD6J9PK5GA   14
  terminal-run      @19YRYDKT4JMB   2

  Experiment harness/v0.12.0
  Eval              Attempt         Score
  ----------------  --------------  -----
  terminal-install  @19VNWKYFC0FC   16
  terminal-init     @1VNQTXJ03XJD   14

Attempts · install
  Experiment install/canary
  Eval          Attempt         Score
  ------------  --------------  -----
  db-gateway    @1SY1PRPXSBFN   5
  gpt-provider  @1QD6PEMZY39P   5
```

没有 `/` 的 Experiment 仍以完整 ID 显示在未分组 summary 与 `Attempts` 小节。Eval 相对标签只有在其首段与
Experiment 显示分组相同时才去掉该段；否则保留完整 Eval ID。宽度仍不足时只折行，不截断 Experiment、Eval
或 Attempt identity。

### Attempt 概览示例

```text
$ niceeval show @01JSHOWATTEMPT
Attempt @01JSHOWATTEMPT
  Experiment  main
  Eval        inspection
  Run         run_01JSHOW
  Attempt     attempt_01JSHOW · slot-1
  Outcome     completed
  Verdict     passed
  Score       3/4

Assertions    available · 5 entries
Evidence      assertions complete · source partial · execution partial

Sections
  source      partial
  execution   partial
  timing      available
  usage       available
  diff        not-recorded

Next
  niceeval show @01JSHOWATTEMPT --source
  niceeval show @01JSHOWATTEMPT --execution
  niceeval show @01JSHOWATTEMPT --timing
  niceeval show @01JSHOWATTEMPT --usage
  niceeval show @01JSHOWATTEMPT --diff
```

Experiment 范围也是人读结果，不是 CLI 过滤后的 Overview 残片：

```text
$ niceeval show --experiment main
Experiment main · 2/3 observed · pass rate 50% · score 3/4
Eval          Attempt             Verdict   Score   Coverage
inspection    @01JSHOWATTEMPT     passed    3/4     partial
packaging     —                    —         —       missing
```

`--record` 在所有形态中只选择已验证的 exact-seal `RecordSnapshot` source，不筛选 Run
、Experiment 或 Attempt。未给它时读取 project operational Store 的单一 sealed cutoff。无 Record 事实、Run、Experiment 或 locator 未命中、
Snapshot 无效、required result shape 不合法与 `--expand` 未命中都以英文诊断写 stderr 并非零退出；
不输出半张表或将 typed missing/partial 改写成进程失败。

`show` 不提供 `--json`、`--report`、history、stats、fresh、grep 或自由 statistics，也不接受 Page、theme、
component、renderer、静态导出、显示位置 handle 或其它作者面。`query` 是唯一 JSON 入口；`view` 不接受 Attempt locator。
CLI 不探测 locale，不提供中文 catalog。
