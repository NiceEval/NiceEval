# Inspection CLI

## `niceeval query`

```sh
niceeval query discover
niceeval query explain --request <file|->
niceeval query run --request <file|->
```

`query` 是 machine 入口：它只以 `niceeval.query/v1` 输出结构化结果，不接受 human 输出模式。每份 stdout
document 都显式包含 `outcome: discovery | success | explanation | failure`。
人在终端中审阅同一批固定 operation 时使用下文的 `niceeval show`；浏览器体验仍由
[Insight](../insight/README.md) 的 `niceeval view` 提供。

`discover` 是静态 catalog，不打开 source。它输出 `outcome: discovery` 的 compact bootstrap，只列出当前版本支持的
operation ID。request shape 由本契约与公开参考文档定义；调用方可用 `explain` 校验完整 request。discover 不复制
schema、selector、错误 union 或最小 follow-up request。

`explain` 与 `run` 才读取完整 request，由 source adapter 打开 facts。前者先交付将读取的 source、selection、
comparison mode 与 fact kinds，避免调用方先取重 payload。后者以 `outcome: success` 交付闭合 protocol result。
协议级失败使用 `outcome: failure`，不借字段缺席模拟另一种 shape。

## 当前 Results

默认 `niceeval show` 与本机 View 回答“当前项目还缺哪些结果”。机器读取使用固定的 `project.get`：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "project.get" }
}
```

request 只包含 `kind` 和可选的非空、去重 `experimentIds: readonly string[]`。ID 必须精确命中当前项目；
任一 ID 未命中时整次请求失败，不输出部分结果。省略时选择当前发现的全部 Experiment。

Experiment Host 一次求值当前目标，并在固定 cutoff 形成[当前适用性判断](../experiments/cache.md#当前结果可用性与执行选择)。
Inspection 消费这个冻结输入并关闭当前指标；终端与浏览器不得在历史 Overview 上自行过滤或重算。
`project.get` 的 `project` result 字段如下，身份和指标继续使用本页既有类型：

| 字段 | 内容 |
| --- | --- |
| `targetIdentity` | 本次完整已求值目标的 opaque identity；不是 Run ID。 |
| `coverage` | `expected`、`covered`、`gaps`，三个非负整数，`covered + gaps = expected`。 |
| `slots` | 每个当前 `(experimentId, evalId, attemptOrdinal)` 恰好一项，按该元组稳定排序。 |
| `totals`、`experiments`、`cells` | 使用既有 aggregate 与 MetricValue 语义，只计当前可用成员；每层保留当前目标分母。 |
| `history` | 未被当前目标选择的位置数组；每项含 `experimentId`、`evalId`、`attemptOrdinal`、`sourceRunId` 与可空的 `locator`，只取各位置最新 occurrence。 |

每个 slot 包含 `experimentId`、`evalId`、`attemptOrdinal`，以及下列互斥内容：

| `state` | 字段 |
| --- | --- |
| `reuse` | `sourceRunId`、`locator`、`relation`、`action`，均指向已发布 Member 及其 exact Attempt。 |
| `gap` | `reason`、`issues`、可空 `sourceRunId`、`previous`；`previous` 为 `null` 或仅含 `sourceRunId`、`locator` 的历史入口。 |

`reason` 只允许以下值：

- `no-result`、`pending`、`not-published`；
- `identity-mismatch`、`outcome-ineligible`、`score-incomplete`；
- `evidence-unavailable`、`timeout-exceeded`、`adoption-unproven`。

底层 reader 或 planning 的具名原因及其作用域保留在 `issues`，不能把损坏或不支持折成 `no-result`。
`previous` 只提供已发布 Attempt 的查看入口；即使它来自更旧 Run，也不能替代当前 source barrier。

`gap` 不是 Attempt outcome。历史 Attempt 仍可查看，但其旧分数不能填入缺口。只有部分计分结果可用时，
Score 显示已有贡献及 `partial` 和样本分母；缺口不计零分，也不外推完整总分。没有贡献时不生成数字。
当前已完成但失败的 Pass Eval 可以 covered；它仍以 failed 贡献通过率。Coverage 不等于成功率。

四条计分题各一次，只有一条完整零分、一条 partial score 与两条没有结果时，必须显示 `Covered 1/4`、
`Gaps 3`、`Score 0 (partial)`。partial Attempt 的已知下界只在详情显示，不加入当前总分。
题内仍按完整 Attempt 取均值，跨题对已有贡献求和；不虚构四题的总满分。
early exit 或预算导致的执行完成度从 Run/Invocation 读取，不能由 coverage 推断。

`project.get` 需要本机当前目标能力。`--record` 或仅有发布 Record 的 Host 返回 `current-target-unavailable`，
并引导使用 `overview.get` 或 exact `run.get`。发现或求值失败同样明确失败，不能把历史结果包装成当前结果。
`discover` 保持静态；`explain` 必须说明此 operation 还读取当前项目声明。

## 历史 Results

AI 要回答“已发布 Record 里有哪些 Experiment、各 Eval 的通过率／分数怎样、哪条 Attempt 值得下钻”时，只运行
一个 `overview.get`，不先枚举 Run 再自行聚合：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": { "kind": "overview.get" }
}
```

`overview` 先按 `experimentId + evalId + attemptOrdinal` 对齐逻辑 slot，再在固定 publication cutoff 内选择
每个 slot 的最新 published occurrence。publication revision、`completedAt`、`startedAt` 与 `runId` 依次打破平局。
origin Run 是否 active 不影响已经原子发布的 Attempt 可见性。

旧 occurrence 仍可由 Run operation 读取，但不重复进入历史 Overview 分母。结果保留 experiment、Eval 路径 group、
Eval、Attempt ordinal、selected Run、target Slot、membership action、origin/reference relation 与 locator。

每个 `experimentId + evalId` cell 交付 `pass | points` evaluation kind；历史 Record 中同一逻辑 cell 留有两种题型时，
协议保留 `mixed` 以忠实读取既有事实。它还交付 expected／observed／classified／missing denominator、四态 Verdict tally、pass rate、points score、
coverage 与 issues。
顶层 totals、Experiment totals 与路径 group totals 由同一批 selected cell 折叠。调用方不得从 locator 数、历史 Run、
最后一条 Attempt 或单独的 score 值重新计算另一套结果。

pass rate 使用已分类 Attempt 作为业务分母；`skipped` 计入分母但不计入 numerator。结果仍显式保留
expected、observed、classified 与 missing，缺失不会被伪装成失败或从完整度中消失。Score 聚合已封存的
earned／possible，不把分数换算成 Pass。

pass rate 与 points 都使用闭合 `MetricValue`：`value`、`state`、`samples`、`total`、`basis`、`issues` 与
Attempt `refs` 始终一起交付。状态穷尽为 `available | partial | unavailable | empty | unsupported | failed`。

有值但样本范围不全是 `partial`；有合格 slot 却没有可形成的值是 `unavailable`；没有合格 slot 是 `empty`。
producer/固定事实族 无此能力是 `unsupported`；已选择事实无法解释是 `failed`。points 的 `value` 是 earned，
`bounds.max` 是 possible；consumer 不从 Assertion 或其它 scalar 重算它。

成本聚合先在每个 physical call 内选择一个 effective cost：reported 包括零并优先，缺席时才采用与 sealed call 绑定的 estimate proof。
聚合不在整条轴上选择 reported 或 estimated，也不把同一调用重复计价。`source` 为 `reported | estimated | mixed`，与
`state` 分开表达；partial estimate 保留已知金额，但不增加完整 coverage。USD 指标遇到非 USD、未知金额、采集 partial 或历史 revision 1 缺口时不能宣称完整。

`overview.cells[].members[].score.value` 是一个 selected Attempt 的 earned 真值。
`overview.cells[].score.value` 是同一 Experiment × Eval 中 eligible Attempt score 的 mean。

`overview.experiments[].score.value` 是可见 per-Eval cell score 的 sum。路径 group 与顶层 totals 从 cell score
折叠。member 与 cell score 的 `basis` 是 `slot`；Experiment、group 与 totals score 的 `basis` 是 `eval`，
其 `samples`／`total` 计 contributing／eligible per-Eval cell。所有值都保留 `MetricValue` state、issues 与 refs。

历史 `mixed` cell 的 pass members 不进入 points 的 `samples` 或 `total`。`totalScore` 不存在，不能成为第二权威字段。

Insight 的历史 Results 调用同一个 `overview.get` result meaning，当前 Results 调用 `project.get`；它只负责 Experiment 选择、表格、链接、
折叠、本地化和成本 × 通过率或分数散点图。它不是另一套 Results 数据源。`query` 只编码 machine document，下文的 `show`
才拥有固定终端排版。

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

图片 Judge 的 detail 只交付图片元数据和已验证的 v3 审计，不重复内嵌原始图片或审计的 base64。
按稳定 `entryId` 与 `imageId` 使用 `attempt.assertion.image` 读取封存原图，`offset` 是原始字节偏移，
`limit` 每页最多 256 KiB。响应交付 `mediaType`、`byteLength`、`sha256`、`base64` 与 `nextOffset`，
最后一页的 `nextOffset` 为 `null`。这个固定 operation 同样支持 `--record` 搬迁读取，不访问作者路径或模型。

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

否则结果明确返回 `source-unavailable` 或 `ambiguous`。target anchor 直接使用同一 Attempt 的
`toolOccurrenceId` 或 `eventId`。

source/field state 也是结果事实，View 只把它们映射到 `data-source-state`／`data-field-state`。

当前已发布事实没有 `toolOccurrenceId` 到 Sandbox `commandId` 的持久 join。command matcher detail 因而只能
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

outline 显示通用领域事件及内建 Agent 投影，保留 producer、主体、时间、摘要、范围与完整性。
conversation 和 command 继续保留各自的专用信息。长文本只给有界 preview；identity index 同样有界并报告遗漏。
精确详情直接选择已封存身份，不要求该项出现在默认摘要中。调用方需要一项详情时，使用对应 selector：

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

`selector.kind` 包括 `item`、`tool-occurrence` 与 `command`，分别使用 `itemId`、
`toolOccurrenceId` 与 `commandId`。通用轨迹使用 `execution-event` / `eventId` 和
`execution-evidence` / `evidenceId`。tool occurrence detail 把同一 occurrence 的 call 与 result 一起交付；
command detail 交付 invocation、outcome 与已封存 stdout/stderr。identity 未命中时返回
`inspection-selection-missing`，不会猜相邻项。

通用事件详情保留事件 envelope、typed JSON payload、已声明关系、scope membership，以及每件 Evidence 最多
2 KiB 的原文预览。Evidence detail 只接受 receipt 中的 `evidenceId`，不接受任意附件 pointer：

```json
{
  "protocol": "niceeval.query/v1",
  "operation": {
    "kind": "attempt.trace.detail",
    "locator": "@<locator>",
    "selector": { "kind": "execution-evidence", "evidenceId": "<stable-evidence-id>", "offset": 0, "limit": 65536 }
  }
}
```

Evidence detail 返回该精确 JSON 值的规范 UTF-8 bytes，以 `base64` 编码；`targetSha256`、`targetByteLength`、
`offset` 与可空 `nextOffset` 一起交付。默认每次 64 KiB，最大 256 KiB，调用方按 `nextOffset` 续读。
这不是整局附件的下载入口，也不重新调用外部系统。

`attempt.trace` 的可选 `traceId`、`sourceId`、`actorId` 精确筛选通用轨迹；每页最多 32 个事件且事件摘要至多 64 KiB。
`execution.continuation` 绑定相同筛选、Attempt origin、source、publication cutoff、family revision 和 behavior version；
续读时保留全部筛选参数，绑定改变返回 `restart-required`。identity index 的遗漏不妨碍按已知稳定 ID 精确展开。

Query 不接受旧 `t<N>.c<M>`、`cmd<N>` 或其它按显示位置派生的 handle。详情中的“完整”只表示完整取回
已经脱敏并按固定事实族上限封口的内容；producer 已写入的 truncation 与 limitations 必须继续可见，
查询不能恢复运行时已经舍弃的原文。只有声明权威总量的 command stream 同时交付 retained bytes 与
`totalSafeUtf8Bytes`；conversation text 只交付已封存值及其 limitation，不能虚构运行时原文总量。

CLI 只在 Node 中运行：Node source adapter 在一个固定 `PublicationCutoff` 下打开已发布 facts，随后调用内部 Inspection selector。
它不启动 HTTP、sqlite-wasm、浏览器或 View session。request 只在固定 operation 的参数边界内选择 `overview.get`、Run、
Attempt、精确 trace identity 或比较集合。命令不接受 SQL、`where`、JSON path、formula、数据库 cursor、rowid、文件位置或调用方
指定的 page size。

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
success 编码 operation result，并带 `behaviorVersion`、source、`PublicationCutoff`、selection、limits、issues 与 Evidence。
explanation 交付同一 operation 的读取范围与 fact kinds。failure 交付 code、reason 与 correction。

每个 source-bound success/explanation document 的 `source` 固定为
`{ kind: facts.kind, publicationCutoffIdentity: facts.cutoff().identity }`。
它不含路径，`runCount` 只在 `publicationCutoff` 中出现。codec 的 allowed/required fields、base envelope 与
`runs.list` envelope 都使用这一字段。

这个 protocol document 只属于 CLI 编码边界，不是 Insight 输入、View DTO、缓存或第二份持久
artifact。CLI、Web 与 Testkit 都从 `niceeval/inspection` 取得同一 Schema、类型与 decoder。Testkit 只在完整
decode `InspectionDocument` 后按 `outcome` 和 operation 语义窄化，不维护宽松 JSON shape。浏览器在自己的 `PublicationCutoff` 上运行相同 operation、参数校验、row codec 与 result
meaning；它不请求或反序列化 `query` stdout。

进度、argv 错误、无法读取 request、无法验证 source，以及无法形成 document 的进程失败只写
stderr 并以非零状态退出。调用方不能根据 stderr 拼接部分 JSON，也不能把 stdout 的 document
与另一 source 或 cutoff 的页混合。

continuation token 绑定 operation、canonical request、source identity 与 `PublicationCutoff`。绑定
改变时，`query` 在 canonical document 中返回 restart correction；调用方必须从新的
discovery 或 request 重新开始。

## `niceeval show`

```sh
niceeval show
niceeval show --all
niceeval show --run <run-id>...
niceeval show --experiment <experiment-id>...
niceeval show @<locator>
niceeval show @<locator> --source
niceeval show @<locator> --execution [--expand <stable-id>]
niceeval show @<locator> --timing
niceeval show @<locator> --usage
niceeval show @<locator> --diff
```

`show` 是英文 human text 入口。它不调用 `query` stdout 或解码 `niceeval.query/v1`，而是与
`query` 一样打开 Node facts adapter，调用具名 Inspection operation，再格式化其闭合 result。

show 的每个投影只接受对应具名 operation 的 typed result；必填 shape 缺失时失败，只有契约
明示的 `null`、optional、`not-recorded` 或 `partial` 才能显示业务 fallback。

renderer 只能决定稳定顺序、终端宽度和文字布局。它不得重选成员，也不得重算
denominator、pass rate、score、coverage、usage、timing、diff 或 Evidence。宽度不足时可折行或截断已声明的 preview，
但不能改变成员、数值、状态或 omitted 数量。

### 固定投影

- 无 selector 时调用 `project.get`，格式化当前 coverage、gaps、totals、Experiment summaries 与
  Experiment → Eval → Attempt table。

  Experiment ID 含 `/` 时，首段形成显示分组，组内 Experiment 与同前缀 Eval 使用相对标签。
  每个 Experiment 小节仍显示一次完整 ID，每个可下钻 Attempt 显示完整稳定 locator。

  默认 Attempt 明细隐藏没有问题的 `passed` 项；`failed` 必须按 Verdict 显示。每个 Experiment 最多展开 5 个 `errored` 项，超出的部分也折叠。
  gap、`skipped`、pending 与 absent 项始终可见。每个 Experiment 显示各结果的隐藏数量及可复制的
  `See more: niceeval show --experiment <id>` 命令。

  `--all` 展开全部 Attempt。展开后的明细先以 `Eval <id>` 缩进分组，不在每个 Attempt 行重复 Eval ID；
  同一 Eval 的多个 Attempt 各占一行。Pass、Score 或历史 mixed Eval 都显示 `Attempt`、`Verdict` 与 `Duration`；
  Score Eval 另外显示 `Score`。`passed + complete` 的分数旁标注 `scored`，Attempt 标题同样使用该人读标签；`failed + complete` 必须保留失败与 earned score。
  标签遵守 [Verdict 的评分展示契约](../verdict/architecture.md#score-eval-的-assertion-score-facts)，canonical `Verdict` 栏仍保留四态。

  Verdict 为 `passed`、`failed`、`errored` 或 `skipped`。Duration 按大小使用 `ms`、`s`、`min` 或 `h`，
  最多保留两位小数。

  membership action 与 origin/reference relation
  仍由具名 operation 保留，可在 Run/Attempt 下钻中查看。

  标题为 `Current results`，先显示 `Covered N/M` 与 `Gaps K`。
  分母来自当前目标；缺口显示具名原因、可用的旧 locator 与下一步。已删除的 Experiment 只出现在 `History`，不计当前分数。
  不用 `Observed` 把历史发布数量暗示成当前结果可用性；目标求值失败显示错误与历史读取命令。
- 一个或多个 `--experiment` 通过同一个 `project.get` 的 exact `experimentIds` 收窄当前目标，完整格式化当前 coverage、cells 与 gaps。
  任一 ID 未命中时整次失败。已删除的 Experiment 可经 `experiment.get` 的固定 query 或 exact Run 读取历史。
- 显式 `--record <file>` 使用历史 `overview.get`，标题为 `Recorded results`；与 `--experiment` 搭配时使用 exact `experiment.get`。
  这些路径不发现或求值当前项目。`--run` 与 Attempt locator 也始终读取固定历史事实。
- 一个或多个 `--run` 逐个调用 exact `run.overview`，并且只消费这一份闭合 result。
  它显示指定 Run 的 identity、时间、denominator、Member/Attempt locators、Verdict、score、coverage、usage 与 limitations。
  CLI 不得组合 `run.get` 与 `run.summary`。重复 flag 的输入顺序不是业务排序 authority。
- `@<locator>` 默认调用 `attempt.get`，显示精确身份、Verdict、score、coverage、Assertion
  摘要、section states 与 limitations，并给出可复制的 source、execution、timing、usage 和 diff 后续命令。
- `@<locator> --source` 调用 `attempt.sources`，显示已封存 source 与 Assertion facts，保留
  source state、location、limitations 与 Evidence；不从文本推断断言或运行时原文。
- `@<locator> --execution` 调用 `attempt.trace` 显示有界 outline。`--expand <stable-id>`
  必须和 `--execution` 一起使用，按持久事件、证据、`itemId`、`toolOccurrenceId` 或 `commandId`
  直接调用 `attempt.trace.detail`。目标可以位于默认摘要之外。导入 key、原生 source eventId、
  `t<N>.c<M>`、`cmd<N>` 或数组位置不能替代持久身份；找不到时返回 selection error，不猜测相邻项。
- `@<locator> --timing` 调用 `attempt.timing`，显示 activity 层级、phase、offset、duration、outcome、limitations 与 omitted count。
- `@<locator> --usage` 调用 `attempt.usage`，只显示其关闭的 input/output token、request 与 cost typed totals，以及每项 total 的 state/coverage。renderer 不得从 observations 聚合 totals，也不得将缺失或 omitted 按零补齐。
- `@<locator> --diff` 调用 `attempt.diff`，显示已封存 window 与 file changes，并保留 binary、oversized、capture failure 等边界。

### selector 与 flag 组合

`@<locator>`、`--run` 与 `--experiment` 是三种互斥 selector。`--run` 与 `--experiment` 可各自重复，
重复值去重后由 Inspection 逐个 exact 选择。所有 selector 必须在同一 `PublicationCutoff` 上命中，命令才输出任何 section。

`--source`、`--execution`、`--timing`、`--usage` 与 `--diff` 都要求一个 Attempt locator，且五者互斥。
`--expand` 只能与 `--execution` 同用。
`--all` 只适用于无 selector 的 Results，不能与 `--experiment`、`--run`、Attempt locator 或 Attempt detail flag 同用。

### 固定 Record 的历史 Results 示例

human renderer 将 pass rate 显示为百分比。`available` 是健康 metric 的默认状态，不附加在数值后；
`partial`、`unavailable`、`empty`、`unsupported` 与 `failed` 仍须明确显示。

Score 在纯 pass 制投影中是不适用的指标，
human renderer 不输出 `Score unsupported` 占位：Totals 及某张表的全部成员均为 pass 制时，分别省略 Score 行或整列。

反过来，纯 score 制 totals 显示 `Verdicts` 与 `Score`，不显示 `Pass rate`；纯 score 制
Experiment 表省略 `Pass rate` 列。只有 `passed + complete` 进入成功排名；`failed + complete` 显示失败并保留 earned score，execution error 仍显示为 `errored`。

包含历史 mixed cell 的投影并排保留 pass rate 与 score。machine result 始终保留原始 typed Verdict 与 metric，不因人读展示而改写。
machine result 始终保留 typed `unsupported`。Experiment summary 按路径首段分组，
Attempt 明细再按完整 Experiment 分表，使 80 列终端可以在同一行保留完整 locator：

```text
$ niceeval show --record ./results.json
Recorded results
  Totals

  Observed   7/7
  Verdicts   5 passed; 1 failed; 1 errored; 0 skipped
  Pass rate  71.43%
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
  3 passed Attempts hidden
  See more  niceeval show --record ./results.json --experiment harness/canary

  Experiment harness/v0.12.0
  1 passed; 1 failed Attempts hidden
  See more  niceeval show --record ./results.json --experiment harness/v0.12.0

Attempts · install
  Experiment install/canary
  Eval gpt-provider
  Attempt         Verdict  Duration  Score
  --------------  -------  --------  -----
  @1QD6PEMZY39P   errored  2.09 s    5

  1 passed Attempts hidden
  See more  niceeval show --record ./results.json --experiment install/canary
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

Experiment selector 是下钻动作，直接显示完整明细，不再要求 `--all`：

```text
$ niceeval show --experiment main
Current results · Experiment main
  Summary

  Covered    3/3
  Gaps       0
  Verdicts   2 passed; 1 failed; 0 errored; 0 skipped
  Pass rate  66.67%

  Attempts
  Eval packaging
  Attempt         Verdict  Duration
  --------------  -------  --------
  @ATTEMPT-FAIL   failed   21.44 s

  Eval inspection
  Attempt         Verdict  Duration
  --------------  -------  --------
  @ATTEMPT-PASS-1 passed   18.34 s
  @ATTEMPT-PASS-2 passed   20.12 s
```

命令读取 project operational Store 的单一 `PublicationCutoff`。当前目标成功求值、Store 读取正常但没有历史结果时，正常返回 `Covered 0/N` 与 `Gaps N`。
当前目标求值失败、source 读取失败、显式 Run / Experiment / locator 未命中、required result shape 不合法与 `--expand` 未命中，都以英文诊断写 stderr 并非零退出。
不输出半张表，不把 typed missing/partial 或正常的当前缺口改写成进程失败。

`show` 不提供 `--json`、`--report`、history、stats、fresh、grep 或自由 statistics，也不接受 Page、theme、
component、renderer、静态导出、显示位置 handle 或其它作者面。`query` 是唯一 JSON 入口；`view` 不接受 Attempt locator。
CLI 不探测 locale，只输出由 Inspection CLI presenter 直接拥有的英语文本，不建立中文或英语 message catalog。
