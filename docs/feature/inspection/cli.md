# Inspection CLI

## `niceeval query`

```sh
niceeval query discover
niceeval query explain [--record <RecordSnapshot>] --request <file|->
niceeval query run [--record <RecordSnapshot>] --request <file|->
```

`query` 是唯一公开的 CLI 查看命令。它承接原 `show` 的固定读取、筛选、比较与解释结果，
但以 `niceeval.query/v1` 输出结构化结果，而不提供第二个终端 renderer。`niceeval show` 不是
公开命令，也不是 `query` 的别名或兼容入口。浏览器中的人读体验由 [Insight](../insight/README.md) 提供。

`discover` 是静态 catalog，不接受 `--record`，也不打开 source。它输出 compact bootstrap，并按 operation
给出 schema、合法 selector、错误 union 与最小 follow-up request。`explain` 与 `run` 才读取完整 request，
由 source adapter 打开 facts；前者先交付将读取的 source、selection、comparison mode 与 fact kinds，避免调用方
先取重 payload，后者交付对应的闭合 protocol result。

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
折叠与本地化。它不是另一套 Overview 数据源；CLI 也不为这份数据增加终端表格 renderer。

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
然后调用 `selectInspectionOperation(facts, operation)`。它不启动 HTTP、sqlite-wasm、浏览器、View session 或
额外 Snapshot；`--record` 也不会生成 query 专用的 projection 或 artifact。

`--record` 与 request 的职责正交。前者选择已验证的 SQLite source；后者在固定 operation 的
参数边界内选择 Overview、Run、Attempt、精确 trace identity 或比较集合。命令不接受 SQL、`where`、
JSON path、formula、数据库 cursor、rowid、文件位置或调用方指定的 page size。

## machine 输出与错误面

`query` 的 protocol 是 `niceeval.query/v1`。成功和协议级领域失败都恰好向 stdout 写一个 canonical protocol
document。它编码 shared query 的 result，带 `behaviorVersion`、source、sealed cutoff、selection、limits、issues
与 Evidence，说明结果能怎样被解释。

每个 `InspectionDocument.source` 固定为 `{ kind: facts.kind, sealedCutoffIdentity: facts.cutoff().identity }`。
它不含路径，`runCount` 只在 `sealedCutoff` 中出现。codec 的 allowed/required fields、base envelope 与
`runs.list` envelope 都使用这一字段。

这个 protocol document 只属于 CLI 编码边界，不是 Insight 输入、View DTO、缓存或第二份持久
artifact。浏览器直接在完整 `RecordSnapshot` 上运行相同 operation、参数校验、row codec 与 result
meaning；它不请求或反序列化 `query` stdout。

进度、argv 错误、无法读取 request、无法验证 source，以及无法形成 document 的进程失败只写
stderr 并以非零状态退出。调用方不能根据 stderr 拼接部分 JSON，也不能把 stdout 的 document
与另一 source 或 cutoff 的页混合。

continuation token 绑定 operation、canonical request、source identity 与 sealed cutoff。绑定
改变时，`query` 在 canonical document 中返回 restart correction；调用方必须从新的
discovery 或 request 重新开始。
