# Inspection 架构

## 共享的固定 query definition

Inspection catalog 是读取语义与业务聚合的唯一 owner。它固定包含 Overview、Experiment、Run、Attempt、比较、
Assertion detail、trace outline/detail、timing、usage、diff、sources 与 artifacts operation。

- Overview、Experiment 与 Run：`overview.get`、`experiment.get`、`runs.list`、`run.get`、`run.summary`、`run.overview`。
- Attempt 首页与下钻：`attempt.get`、`attempt.assertion.detail`、`attempt.trace`、`attempt.trace.detail`。
- Attempt 固定切片：`attempt.timing`、`attempt.usage`、`attempt.diff`、`attempt.sources`、`attempt.artifacts`。
- 比较：`runs.compare`。

catalog 的穷尽 union 是可问问题的边界；它不接受任意 SQL、关系遍历、JSON path、
统计或公式。

每个 query definition 拥有具名 operation、穷尽 request 与合法 selection。它还拥有 browser-neutral
`selectInspectionOperation(facts, operation)` selector、具名参数绑定、typed fact codec 与确定的 result meaning。

`facts.ts` 是所有 operation 共用的唯一 facts reader。它产生的 facts 同时固定 kind 与 cutoff，operation 不再打开
source 或拥有 lifecycle。request、facts 或已封存事实无法满足 operation 时，selector 返回显式 typed error。
adapter 不把路径、reader 细节或 Node/Browser 生命周期包装成另一套 selector error。

selection 可以定位 Run、Attempt 或比较两组 Run，却不能把存储 cursor、rowid、文件位置或调用方
page size 作为公开 selector。重 payload 与列表使用有界 domain page；continuation token 绑定
operation、canonical request、source identity 与 sealed cutoff。

row codec 解码 SQLite rows；result meaning 定义 selection audit、分母、缺失、Evidence、
comparison 与限制怎样形成。这两层属于同一 catalog，而不是 Node 侧先投影一份 JSON 给浏览器。
改变 SQL、row codec 或 result meaning 都是同一个 operation 的行为变化，必须与
`behaviorVersion` 一起审计。

`runs.compare` 固定提供 `side-by-side`、`exact` 与 `paired` 三种模式。`exact` 证明
member domain 和 member set 相同。`paired` 只使用第一方 pairing key，并同时交付 left、
right、pair 的 denominator、unmatched、excluded、missing、issues 与 Evidence。

## Show 消费的 typed operation

Show 不拥有范围筛选器。每个命令形态只能提交下表的 selector，并消费对应 operation 关闭的 typed result。
它不能先取 Overview，再用 CLI 代码按 Experiment 或 Run 过滤。

| operation | selector | result owner 与字段语义 | 缺失与 partial | Show 映射 |
| --- | --- | --- | --- | --- |
| `overview.get` | 无 | `InspectionOverviewResult` 关闭 totals、Experiment aggregates、Eval cells、members、MetricValue、coverage、issues 与 locators。 | 无可选 slot 时交付 `empty` MetricValue 与显式分母；不完整 cell 保留 `partial`、missing 与 issues。 | `niceeval show` 的 totals、Experiment summaries 与 Experiment → Eval → Attempt 表。 |
| `experiment.get` | exact `experimentId` | `InspectionExperimentResult` 只含命中 Experiment 的 aggregate 和 cells；cells 保留 members 与 locators。 | ID 未命中是 `inspection-selection-missing`，不交付空的伪 Experiment。cell 的 partial 语义与 Overview 一致。 | 每个 `--experiment <experiment-id>` 一节。重复 flag 不改变 operation 的成员与排序。 |
| `run.overview` | exact `runId` | `InspectionRunOverviewResult` 一次关闭 Run/Experiment identity、时间、expected/observed denominator、Member state/locator/origin relation、Verdict、score、coverage、usage 状态与摘要，以及 limitations。 | ID 未命中是 `inspection-selection-missing`。已命中 Run 中未观测的 expected Member 保留 `missing`；partial、not-recorded 与 unavailable 事实保留 typed state、issues/limitations，不按失败或零补齐。 | 每个 `--run <run-id>` 一节；Show 只消费这一份 result。 |

Show 对重复 `--experiment` 或 `--run` 先在同一 pinned facts 上查找全部 exact selector。
任一 selector 未命中时整次失败，不先输出已命中的部分 section。输入顺序也不能成为业务排序依据。

`run.get` 与 `run.summary` 继续是兼容的 machine operations；新增 `run.overview` 不删除或改变它们。
但 `niceeval show --run` 不能组合两份 machine result，也不能在 renderer 中 join Run、Member 与 Attempt。

### Run Overview 的闭合语义

`run.overview` 是 Inspection 在 Record 与 human Delivery 之间拥有的固定 result。它以 exact `runId` 选择一个
已封口 Run，并在同一个 sealed cutoff 上一次形成：

- Run identity、关联 Experiment identity、`startedAt` 与 `completedAt`；
- expected／observed denominator，以及每个 expected Member 的 Eval/Slot identity、state、Attempt locator 与
  `origin | reference | null` relation；
- 已关闭的 Verdict、score、coverage，以及 usage 的 typed state 与摘要；
- 说明 missing、partial、not-recorded、unavailable、truncation 或其它证据边界的 issues/limitations。

exact Run 存在但 expected Member 没有 observed Attempt 时，selection 仍然成功。该 Member 保持 `missing`，
denominator 的 expected 与 observed 不相等。相关 aggregate/coverage/usage 明示 partial 或相应缺席状态。
Verdict 缺席不是 failed，score 或 usage 缺席不是零，origin relation 也不能由相邻 Run、相同 locator 或显示顺序猜测。

SQLite 持久层继续只保存 Run、Slot、Member、Attempt、Attachment 等封存事实。`InspectionRunOverviewResult`
由 pinned facts 纯选择并解释，不写回 SQLite，不建立 materialized overview、query cache、Show DTO 或其它
派生 artifact；同一 facts 与 cutoff 必须形成同一闭合结果。

### Attempt 首页与证据切片

Attempt operation 都以一个 canonical `@<locator>` 为 selector。locator 未命中是
`inspection-selection-missing`；Show 不会用 Attempt ID、数组位置或文本相似度补配。

| operation | result owner 与字段语义 | 缺失与 partial | Show 映射 |
| --- | --- | --- | --- |
| `attempt.get` | `InspectionAttemptResult` 交付 Experiment/Eval/Run/Attempt 身份、outcome、Verdict、score、Assertion 索引与摘要、Evidence coverage、limitations 与每个 section 状态。 | section 状态穷尽为 `available | not-recorded | partial | unavailable`。Assertion 索引另有 `available | not-recorded | invalid`。 | `niceeval show @<locator>` 的 Attempt 概览。renderer 将 sources/trace 标为 source/execution，并列出 timing、usage、diff 状态与可复制的 next commands。 |
| `attempt.sources` | `InspectionSourcesResult` 关闭 captured source items、content state、Assertion source sites、Evidence、`hasMore` 与 omitted count。 | 根状态是 `available | not-recorded | invalid`。单项 content 可为 `omitted`，有界结果用 `hasMore` 和 omitted count 声明。 | `@<locator> --source`；只排版已封存 source 与 Assertion 位置，不读当前工作树。 |
| `attempt.trace` | `InspectionTraceResult` 关闭 conversation turns、commands、limitations、preview 边界，以及全量 `itemId`/`toolOccurrenceId`/`commandId` identity index。 | conversation 与 commands 各自保留 `complete | partial | not-recorded | invalid`。preview 省略不会删除 identity。 | `@<locator> --execution` 的有界 outline 与 stable identity 索引。 |
| `attempt.trace.detail` | selector 是 locator 加 `itemId`、`toolOccurrenceId` 或 `commandId` 的穷尽 union。`InspectionTraceDetailResult` 只交付命中项的 kind、stable identity 与已封存 body。 | stable identity 未命中是 selection error。已封存 truncation、redaction 与 limitation 原样保留。 | `--execution --expand <stable-id>`；不接受 `t<N>.c<M>`、`cmd<N>` 或显示位置。 |
| `attempt.timing` | `InspectionAttemptTimingResult` 交付 state、limitations、有序 activity identity、parent/turn 关系、phase、label、offset、duration、outcome 与 omitted count。 | state 是 `complete | partial | not-recorded | invalid`。有界读取用 `hasMore` 和 `omittedActivityCount` 声明，不从 Attempt 总耗时猜 phase。 | `@<locator> --timing` 的有序 activity 树与明确状态。 |
| `attempt.usage` | `InspectionAttemptUsageResult` 关闭 `totals.inputTokens`、`totals.outputTokens`、`totals.requests` 与 `totals.cost`。每项 total 都交付 typed `state`、`value` 与 `coverage`；observations 只是 provenance。 | total state 是 `complete | partial | not-recorded | invalid`。缺失不按零补齐；partial、omitted 与 turn coverage 均保留在 result 中。 | `@<locator> --usage` 只显示 operation totals 及其 state/coverage。 |
| `attempt.diff` | `InspectionAttemptDiffResult` 交付有序 window、change identity、path、created/modified/deleted kind，以及 before/after revision 边界。 | state 是 `complete | partial | not-recorded | invalid`。binary、oversized、capture failure 都保留具名 revision state，不猜 patch。 | `@<locator> --diff` 的 window 与 file-change 摘要；不读 Sandbox 或 Git 现场。 |

上表的 required shape 缺失是 typed result 协议错误，Show 必须失败。只有 operation 已声明的空值、
`not-recorded`、`partial`、`unavailable`、`invalid`、`omitted` 或 `truncated` 才是可呈现的业务状态。

## Overview 与详情读取

`overview.get` 是 Insight Overview 与 machine consumer 共用的默认装配。它从同一个 sealed cutoff 按
`experimentId + evalId + attemptOrdinal` 对齐 logical slot，并以 `completedAt`、`startedAt`、`runId` 依次选择
最新 occurrence。

cell 是 `pass | points | mixed`、MetricValue、denominator、missing、coverage、issues 与 Attempt locator 的最小
聚合 owner。Experiment、Eval path group 与顶层 totals 只从这些 selected cell 折叠。

Node 与 Browser adapter 通过 `selectInspectionOperation(facts, { kind: "overview.get" })` 复用同一 Overview
选择，不能分别维护一份 CLI aggregation 与 View aggregation。`show` renderer 与 Insight
View 都只消费这份闭合结果；它们可以分别排版，但不能重选成员或重算 denominator、
pass rate、score、coverage 与 Evidence。

show 按具名 operation 消费收窄 typed result：必填 shape 漂移是读取失败，只有 operation 已声明的
`null`、optional、`not-recorded` 与 `partial` 是可呈现的业务缺席。

MetricValue 使用 `available | partial | unavailable | empty | unsupported | failed` 的穷尽状态，并始终保留
samples、total、basis、issues 与 refs。pass rate 的 classified denominator 包含 skipped；points 的 value/bounds
分别关闭 earned/possible。状态与数值一起由 selector 决定，renderer 不能从 tally 或 contribution 重算。

score I/O 由 `overview.get` 关闭。`overview.cells[].members[].score.value` 是一个 selected Attempt
的 earned 真值。`overview.cells[].score.value` 是同一 Experiment × Eval 中 eligible Attempt score 的 mean。

`overview.experiments[].score.value` 是可见 per-Eval cell score 的 sum。路径 group 与顶层 totals 继续从 cell
score 折叠，不从 members 或 Attempt 重算。member 与 cell score 使用 `basis: slot`；Experiment、group 与 totals
score 使用 `basis: eval`，其 samples／total 计 contributing／eligible per-Eval cell。它们都保留 `MetricValue`
state、issues 与 refs。

`mixed` cell 的 pass members 不进入 points 的 `samples` 或 `total`。`totalScore` 不是另一个权威字段；selector、
machine consumer 与 View 都只读取已经关闭的 `score.value`。

`attempt.assertion.detail` 以 `entryId` 读取一项完整已封存 Assertion。browser-neutral selector 把 entry、
source sites、规范化 check/decision diagnostic tree 与 matcher artifact 一起关闭。
diagnostic 的 child 顺序、每节点状态及 tool/event anchor 均来自已封存事实。它不能把 compact
`attempt.get` representative 当完整 matcher ledger，也不能把 `attempt.sources` 的位置反推成 entry。

matcher debugger 同时交付 evaluation cut 与 final source ledger。每行保留稳定 locator、summary、detail、
evaluation state 与 exact/unavailable conversation target；cut 外行明确标为 `outside-snapshot`。

selector 只在以下证据全部吻合时声明 `identityRelation: exact`：

- Agent Turns identity；
- snapshot cut；
- retained overlay；
- ordered path；
- receipt count。

结果同时保留 `overlayRetention`、ordered `steps` 与 source limitations。无法证明时关闭为
`source-unavailable` 或 `ambiguous`，不能从 trace、SQL 顺序或显示文本补配。

tool/event matcher anchor 与 trace 共用 `toolOccurrenceId`／`eventId`。Sandbox command receipt 则拥有独立
`commandId`；Record 未封存二者 join 时，selector 必须返回 unavailable join，不能从 turn、文本、argv 或
相邻位置猜配。

`attempt.trace` 是有界 outline，不是假装完整的事件 dump。它以轻量 identity index 枚举已封存的全部
`itemId`、精确 `toolOccurrenceId` 与 `commandId`，并把 preview 是否截断与未返回项数写进 result。
`attempt.trace.detail` 只能以这些
已封存 identity 选择一项；它不接受 Turn 序号、卡片序号、数组 index 或显示层 handle。tool occurrence
选择同时关闭 call/result 配对；command 选择关闭 invocation 与 stdout/stderr 的 retained/total 边界。

outline preview 的预算属于 Inspection delivery；identity index 只解决选择，不宣称 preview 完整。Record
family 的采集上限属于更早的事实边界。detail
可以绕过 outline preview，但不能绕过脱敏、family truncation 或 content admission。Legacy Record 没有精确
tool occurrence identity 时，outline 明示 unavailable，detail 不从旧 call id 或相邻顺序猜配。

## source adapter 与纯 selector

query definition 与 driver 无关。每个 source adapter 都只打开 pinned facts、调用
`selectInspectionOperation(facts, operation)`，并在自己的生命周期中释放资源；adapter 不定义另一份 selection、
比较或业务聚合。selector 不依赖 Node/Browser Host 或打开中的 reader。

| adapter | source 与职责 | 不提供 |
| --- | --- | --- |
| Node | `niceeval query` 的 `node:sqlite` source adapter 打开 live operational Record 的 sealed cutoff，或指定且已验证的 `RecordSnapshot`，然后调用 selector。 | HTTP、sqlite-wasm、View UI、session、额外 Snapshot 或 Node-only projection。 |
| Browser | Insight 的 sqlite-wasm Worker 在现有完整 `RecordSnapshot` 上打开 facts 后调用同一 selector。Worker 独占 connection 与 statement lifecycle，并只分派具名 operation 和已验证 request。 | live Record、任意 `execute(sql)`、SQL console、业务 REST、View DTO 或 Snapshot 写入。 |

浏览器中的 React 组件只调用 Insight 暴露的具名读取入口。它们不直接拿 SQLite connection、
statement 或 SQL，也不把每个 route 的结果做成另一套 query。Worker port 是 browser-local adapter
边界，不是对外业务 API。

## 关闭的 result

每次读取都交付一个可编码的 Inspection result。它至少带有以下闭合事实：

| 字段 | 含义 |
|---|---|
| `behaviorVersion` | operation 采用的固定解释语义版本。 |
| `source` | 固定为 `{ kind: facts.kind, sealedCutoffIdentity: facts.cutoff().identity }` 的 provenance；不得含 path。 |
| `sealedCutoff` | 本 result 所读取的 exact Seal。 |
| `selection` | request 与实际命中成员的 selection audit。 |
| `result` | operation 所得 Run、Attempt、比较或调试事实。 |
| `limits` | 有界读取已经到达的固定界限与继续读取条件。 |
| `issues` | 缺失、partial 或无法解释的已知问题。 |
| `evidence` | 每项事实可追溯的 Evidence。 |

`InspectionDocument` 的 codec 对每个成功或协议级领域失败的 operation document 都要求上述 `source`。
base envelope 与 `runs.list` envelope 使用同一字段。

`runCount` 只属于 `sealedCutoff`，不在 `source` 重复。
score、coverage、usage、diagnostics 和 Experiment/Eval Overview 都在这个 result 中关闭。
Inspection 决定 member、denominator、缺失与可比性；Insight 用同一 query definition 取得这些
事实，不能在浏览器从 raw runs 猜算 overview、排名、趋势或聚合。machine consumer 也只能呈现
同一闭合结果。

source、selection、sealed cutoff、request 或 `behaviorVersion` 改变时，continuation
不能拼接旧页，operation 返回 restart correction。`limits` 从不静默删去事实，`issues` 也
不能被 consumer 隐藏或改写。

## current schema 与领域结果

Node 与 Browser 各自的 source adapter 的迁移与验证先确认 source 使用 current Record schema，才读取 pinned
facts。旧 schema、迁移失败或无法验证 source 是打开错误，不能被编码为一个已关闭的业务结果。

`not-recorded`、`partial`、`unavailable`、`truncated` 与 `omitted` 都是 current schema 上的领域结果。
它们分别说明事实未采集、只取得一部分、此处不能提供、受有界交付限制，或按 operation 的明确规则省略。每项都带
相应的 selection、limits、issues 或 Evidence；它们不是 schema 兼容、reader 旁路或前端补偿。

## source 生命周期

Node source adapter 要么定位 project operational SQLite Store，要么验证 sealed-only `RecordSnapshot`。
它持有短寿 SQLite reader 与 exact sealed cutoff，读取 facts 后直接调用 selector。adapter 不迁移输入，
也不暴露 row、cursor、reader、Scope 或数据库能力。

Node operation 在 protocol 编码前关闭 reader 与所有内容 handle。未指定 `--record` 时，每次调用从 operational
Store 选择一个 sealed cutoff；`RecordSnapshot` 固定其 exact Seal，不会 watch 或 refresh。调用方不能把普通
SQLite copy、checkpoint 文件或任意外部文件当作 Snapshot source。

浏览器 adapter 只接收已经形成且完整的 read-only `RecordSnapshot`。提供 SQLite bytes 与保护
其 transport 属于 Insight/Record Host。建立 session、刷新 generation 与关闭 Worker 也由它们拥有；
Inspection 不创建 `InsightSnapshot`、JSON DTO、query cache 或其它中间 artifact。SQLite Snapshot
仅是同一份 sealed Record 的一致只读副本。

Inspection 只拥有 sealed facts 的读取与解释。人读 navigation、表格、drawer、语言、
Preview、Snapshot transport、session 与 Playground 写入规则属于 [Insight](../insight/README.md)。
