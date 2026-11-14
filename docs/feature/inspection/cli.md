# Inspection CLI

## 读结果的命令

读结果只有一套写法：先写要看的对象，再写这个对象的哪一方面，需要单项详情时再给它的稳定 ID。

```sh
niceeval show [<对象>...] [<方面>] [<ID>] [--json] [--explain] [--all] [--continuation <token>] [方面专属 flag]
niceeval compare <run>... -- <run>... [--mode paired|side-by-side|exact] [--max-regressions <n>] [--json]
niceeval view [<对象>] [<方面>] [<ID>]
```

`niceeval show` 是人、coding agent 与脚本唯一需要学的入口：默认输出终端排版，追加 `--json` 交付机器 document。
每个固定 operation 都能由一条 `show` 命令到达；输出里怎样打印对象与 ID，命令就怎样接受它们，复制即可粘贴。
浏览器体验由 [Insight](../insight/README.md) 的 `niceeval view` 提供，它接受同样的对象、方面与 ID。

CLI 不接受手写 JSON request，也没有 operation 目录或 request schema 需要查。
agent 只需要知道 `niceeval show --json`，之后顺着每份 document 的 [`links`](#下一步与-links) 下钻。
需要知道一次读取会读哪些事实时，在同一条命令后加 `--explain`，见 [machine 输出与错误面](#machine-输出与错误面)。

### 对象

对象带类型前缀，与输出中打印的形式相同：

| 对象 | 写法 | operation |
| --- | --- | --- |
| 当前结果 | 省略 | `project.get` |
| Attempt | `@<locator>` | `attempt.get` 与 `attempt.usage` |
| Experiment | `exp:<experiment-id>`，可重复 | `experiment.get` |
| Run | `run:<run-id>`，可重复 | `run.get` |
| Run 列表 | `runs` | `run.list` |
| 外部 Record | 任一对象加 `--record <file>` | 同上，读取该文件；省略对象时为 `overview.get` |

### Attempt 的方面与 ID

| 方面 | operation | ID 前缀（可省略方面词） |
| --- | --- | --- |
| `assertions` | `attempt.assertion.detail`（列表） | `ae_` → 单条断言 |
| `source` | `attempt.sources` | — |
| `execution` | `attempt.trace` | `tool_`、`command_`、`item_`、`turn_`、`evt_` 等 trace 稳定 ID → `attempt.trace.detail` |
| `timing` | `attempt.timing` | — |
| `usage` | `attempt.usage`；加 `--reprice <file>` 为 `attempt.reprice` | — |
| `diff` | `attempt.diff` | `fc_` → 带 `changeId` 的 `attempt.diff`，显示 unified diff |
| `artifacts` | `attempt.artifacts` | 产物 ID → `attempt.artifact` |

ID 前缀与方面的对应关系由 Inspection 拥有的一张表决定，`show` 与 `view` 共用这张表。
给出 ID 时可以省略方面词：`niceeval show @1RSAXZ5EHJH2V fc_3f90…` 与 `niceeval show @1RSAXZ5EHJH2V diff fc_3f90…` 等价。
给出的方面词与 ID 前缀不符，或 ID 前缀不在表中时，命令失败并列出该对象可用的方面。

Experiment 的方面只有 `assertions`，即[跨 Experiment 的判据矩阵](#跨-experiment-的判据矩阵)，可带多个 `exp:` 与 `--eval <prefix>`。
Run、Run 列表与当前结果没有方面。

断言图片写作 `niceeval show @<locator> ae_<id> image <image-id> --output <file>`，只把字节写入文件，不向终端输出二进制。

比较两组 Run 不是“看一个对象”，因此是独立动词 `niceeval compare`，左右两组用 `--` 分开，见[比较两组 Run](#比较两组-run)。

## 当前 Results

默认 `niceeval show` 与本机 View 回答“当前项目还缺哪些结果”，二者都调用固定的 `project.get`。

operation request 只包含 `kind` 和可选的非空、去重 `experimentIds: readonly string[]`。ID 必须精确命中当前项目；
任一 ID 未命中时整次请求失败，不输出部分结果。省略时选择当前发现的全部 Experiment。

Experiment Host 一次求值当前目标，并在固定 cutoff 形成[当前适用性判断](../experiments/architecture/cache.md#当前结果可用性与执行选择)。
Inspection 消费这个冻结输入并关闭当前指标；终端与浏览器不得在历史 Overview 上自行过滤或重算。
`project.get` 的 `project` result 字段如下，身份和指标继续使用本页既有类型：

| 字段 | 内容 |
| --- | --- |
| `targetIdentity` | 本次完整已求值目标的 opaque identity；不是 Run ID。 |
| `coverage` | `expected`、`covered`、`gaps`，三个非负整数，`covered + gaps = expected`。 |
| `plannedAttempts` | 每个当前 `(experimentId, evalId, attemptOrdinal)` 恰好一项，按该元组稳定排序。 |
| `totals`、`experiments`、`cells` | 使用既有 aggregate 与 MetricValue 语义，只计当前可用成员；每层保留当前目标分母。 |
| `history` | 未被当前目标选择的位置数组；每项含 `experimentId`、`evalId`、`attemptOrdinal`、`sourceRunId` 与可空的 `locator`，只取各位置最新 occurrence。 |

每个 Planned attempt 包含 `experimentId`、`evalId`、`attemptOrdinal`，以及下列互斥内容：

| `state` | 字段 |
| --- | --- |
| `reuse` | `sourceRunId`、`locator`、`relation`、`action`，均指向已发布 Member 及其 exact Attempt；经身份域变更沿用时另有 `explanation`。 |
| `gap` | `reason`、`issues`、可空 `sourceRunId`、`previous`；`previous` 为 `null` 或仅含 `sourceRunId`、`locator` 的历史入口。`reason` 为 `identity-mismatch` 或 `adoption-unproven` 时另有 `explanation`。 |

`explanation` 是[差异说明](../experiments/architecture/cache.md#差异说明)的 `IdentityExplanation`，与 `exp --dry --json`、`accept --dry` 同一结构和同一比较对象。
reuse 分支只在 `kind: "match"` 时出现，`via` 列出所用的身份域变更；digest 直接相等的沿用不带该字段。
身份差异不进入 `issues`：`issues` 只保存 reader 与 planning 的具名问题。

`reason` 只允许以下值：

- `no-result`、`pending`、`not-published`；
- `identity-mismatch`、`outcome-ineligible`、`score-incomplete`；
- `evidence-unavailable`、`timeout-exceeded`、`adoption-unproven`、`stateful-input`。

State 位置在 `project.get` 中是 `gap`，reason 为 `stateful-input`；没有 reader 错误时 issues 为空，previous 可以指向历史 Attempt。
例如位置片段为 `{"experimentId":"codex-mempal","evalId":"react-hook-form/first","attemptOrdinal":1,"state":"gap","reason":"stateful-input","issues":[],"sourceRunId":null,"previous":null}`。
这不修改固定历史 Run 的 Verdict；`exp --dry` 说明本轮执行，不能把历史 saved 当作下一次起点等价证明。

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
`show --explain` 必须说明此 operation 还读取当前项目声明。

## 历史 Results

AI 要回答“已发布 Record 里有哪些 Experiment、各 Eval 的通过率／分数怎样、哪条 Attempt 值得下钻”时，只运行
一个 `overview.get`，不先枚举 Run 再自行聚合。省略对象并带 `--record <file>` 的 `show` 调用它。

`overview` 先按 `experimentId + evalId + attemptOrdinal` 对齐逻辑 Planned attempt，再在固定 publication cutoff 内选择
每个 Planned attempt 的最新 published occurrence。publication revision、`completedAt`、`startedAt` 与 `runId` 依次打破平局。
origin Run 是否 active 不影响已经原子发布的 Attempt 可见性。

旧 occurrence 仍可由 Run operation 读取，但不重复进入历史 Overview 分母。结果保留 experiment、Eval 路径 group、
Eval、Attempt ordinal、selected Run、target Planned attempt、membership action、origin/reference relation 与 locator。

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

有值但样本范围不全是 `partial`；有合格 Planned attempt 却没有可形成的值是 `unavailable`；没有合格 Planned attempt 是 `empty`。
producer/固定事实族 无此能力是 `unsupported`；已选择事实无法解释是 `failed`。points 的 `value` 是 earned，
`bounds.max` 是 possible；consumer 不从 Assertion 或其它 scalar 重算它。

成本聚合先在每个 physical call 内选择一个 effective cost：reported 包括零并优先，缺席时才采用与 sealed call 绑定的 estimate proof。
聚合不在整条轴上选择 reported 或 estimated，也不把同一调用重复计价。`source` 为 `reported | estimated | mixed`，与
`state` 分开表达；partial estimate 保留已知金额，但不增加完整 coverage。USD 指标遇到非 USD、未知金额或采集 partial时不能宣称完整。

`overview.cells[].members[].score.value` 是一个 selected Attempt 的 earned 真值。
`overview.cells[].score.value` 是同一 Experiment × Eval 中 eligible Attempt score 的 mean。

`overview.experiments[].score.value` 是可见 per-Eval cell score 的 sum。路径 group 与顶层 totals 从 cell score
折叠。member 与 cell score 的 `basis` 是 `planned-attempt`；Experiment、group 与 totals score 的 `basis` 是 `eval`，
其 `samples`／`total` 计 contributing／eligible per-Eval cell。所有值都保留 `MetricValue` state、issues 与 refs。

历史 `mixed` cell 的 pass members 不进入 points 的 `samples` 或 `total`。`totalScore` 不存在，不能成为第二权威字段。

Insight 的历史 Results 调用同一个 `overview.get` result meaning，当前 Results 调用 `project.get`；它只负责 Experiment 选择、表格、链接、
折叠、本地化和成本 × 通过率或分数散点图。它不是另一套 Results 数据源。`show --json` 只编码 machine document，
文本 `show` 才拥有固定终端排版。

## 从 Attempt outline 下钻到一项详情

`attempt.get` 是 Attempt 首页：它交付身份、Verdict、score、Assertion Evidence、coverage 与 limitations。
它列出 Assertion `entryId`／display，并逐项声明 section 状态。section 包括 assertions、trace、sources、diff、
artifacts、timing、usage、commands 与 diagnostics，状态为 `available | not-recorded | partial | unavailable`。
需要看一项 Assertion 的完整调试依据时按稳定 `entryId` 读取：

```sh
niceeval show @<locator> ae_<stable-id>
```

operation request 是 `{ kind: "attempt.assertion.detail", locator, entryId, projection? }`。
`projection` 可选 `full | compact`，省略时默认为 `full`。`compact` 只返回 `check`、判定状态与 `rationale`，
省略完整工具调用行与原始材料全文，保证单次响应体积安全，避免外部脚本管道溢出。
`show` 默认请求 `compact`，加 `--full` 请求 `full`。

图片 Judge 的 detail 只交付图片元数据和已验证的 v3 审计，不重复内嵌原始图片或审计的 base64。
按稳定 `entryId` 与 `imageId` 使用 `attempt.assertion.image` 读取封存原图，CLI 写法是 `show @<locator> ae_<id> image <image-id> --output <file>`，`offset` 是原始字节偏移，
`limit` 每页最多 256 KiB。响应交付 `mediaType`、`byteLength`、`sha256`、`base64` 与 `nextOffset`，
最后一页的 `nextOffset` 为 `null`。这个固定 operation 同样支持 `--record` 搬迁读取，不访问作者路径或模型。

文字上下文材料的 `attempt.assertion.detail` 完整机器结果上限为 32 MiB，保留完整 source content 与裁判审计。
它容纳 4 MiB 事实内容、8 MiB 审计 envelope 的 base64、解码审计及字段开销，不经过默认 512 KiB 的结果截断。
多模态 detail 沿用 512 KiB 的 metadata 与解码审计结果，原图仍按上述 operation 分页。
`show` 的人读正文保持有界 preview，但直接显示 [材料容量诊断](../assertions/library/custom-assertions.md#材料选择)，不因正文较大省略原因。

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

```sh
niceeval show @<locator> execution
```

outline 显示通用领域事件及内建 Agent 投影，保留 producer、主体、时间、摘要、范围与完整性。
conversation 和 command 继续保留各自的专用信息。长文本只给有界 preview；identity index 同样有界并报告遗漏。

通用事件项带 `display`，是 Adapter 写入时封存的展示块的有界预览：

```ts
type PreviewText = { readonly preview: string; readonly omittedBytes: number };

type ExecutionDisplay =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly blocks: readonly ExecutionDisplayBlockPreview[] };

type ExecutionDisplayBlockPreview =
  | { readonly kind: "text"; readonly text: PreviewText }
  | { readonly kind: "message"; readonly role: "user" | "assistant" | "system" | "other"; readonly speaker?: string; readonly text: PreviewText }
  | { readonly kind: "fields"; readonly fields: readonly { readonly label: string; readonly value: PreviewText | number | boolean | null }[] }
  | { readonly kind: "code"; readonly language?: string; readonly text: PreviewText }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string; readonly mediaType: string; readonly byteLength: number; readonly sha256: string };
```

每个文本字段与 `fields` 字符串值最多预览 1 KiB，截在码点边界；`omittedBytes` 按 UTF-8 字节由 Inspection 计算。
Inspection 按需收缩展示块预览，使单个事件的序列化投影不超过 8 KiB；页预算按序列化投影计，每页至少交付一个事件。
envelope 字段（actor label、evidence label、unresolved reason）没有预览形状，单靠它们超过 8 KiB 时沿用既有页预算规则。

由 Conversation 投影而成的事件 `display` 为 `absent`。`execution-event` detail 交付完整展示块。
精确详情直接选择已封存身份，不要求该项出现在默认摘要中。调用方需要一项详情时，直接给出它的稳定 ID：

```sh
niceeval show @<locator> tool_<stable-id>
```

Inspection 按 ID 前缀形成 `attempt.trace.detail` 的 `selector`。`selector.kind` 包括 `item`、`tool-occurrence` 与 `command`，分别使用 `itemId`、
`toolOccurrenceId` 与 `commandId`。通用轨迹使用 `execution-event` / `eventId` 和
`execution-evidence` / `evidenceId`。tool occurrence detail 把同一 occurrence 的 call 与 result 一起交付；
command detail 交付 invocation、outcome 与已封存 stdout/stderr。identity 未命中时返回
`inspection-selection-missing`，不会猜相邻项。

通用事件详情保留事件 envelope、typed JSON payload、已声明关系、scope membership，以及每件 Evidence 最多
2 KiB 的原文预览。Evidence detail 只接受 receipt 中的 `evidenceId`，不接受任意附件 pointer；
它的 selector 是 `{ kind: "execution-evidence", evidenceId, offset?, limit? }`。

Evidence detail 返回该精确 JSON 值的规范 UTF-8 bytes，以 `base64` 编码；`targetSha256`、`targetByteLength`、
`offset` 与可空 `nextOffset` 一起交付。默认每次 64 KiB，最大 256 KiB，调用方按 `nextOffset` 续读。
这不是整局附件的下载入口，也不重新调用外部系统。

`attempt.trace` 的可选 `traceId`、`sourceId`、`actorId`、`eventType` 精确筛选通用轨迹；每页最多 32 个事件且事件摘要至多 64 KiB。
`execution.continuation` 绑定相同筛选、Attempt origin、source、publication cutoff 和当前 family；
续读时保留全部筛选参数，绑定改变返回 `restart-required`。identity index 的遗漏不妨碍按已知稳定 ID 精确展开。

Inspection 不接受旧 `t<N>.c<M>`、`cmd<N>` 或其它按显示位置派生的 handle。详情中的“完整”只表示完整取回
已经脱敏并按固定事实族上限封口的内容；producer 已写入的 truncation 与 limitations 必须继续可见，
查询不能恢复运行时已经舍弃的原文。只有声明权威总量的 command stream 同时交付 retained bytes 与
`totalSafeUtf8Bytes`；conversation text 只交付已封存值及其 limitation，不能虚构运行时原文总量。

CLI 只在 Node 中运行：Node source adapter 在一个固定 `PublicationCutoff` 下打开已发布 facts，随后调用内部 Inspection selector。
它不启动 HTTP、sqlite-wasm、浏览器或 View session。对象、方面与 ID 只在固定 operation 的参数边界内选择 `overview.get`、Run、
Attempt、精确 trace identity 或比较集合。命令不接受 SQL、`where`、JSON path、formula、数据库 cursor、rowid 或文件位置。

分页只有一种写法：任何一页放不下的 `show` 输出都带 `next-page` link，同一条命令加 opaque `--continuation <token>` 读下一页，包括 Run 列表、execution outline、产物目录与单个对象的正文。页大小由 operation 固定，调用方不能放宽；断言图片写入文件，不分页。

Run 详情只有一个 operation：`run.get`。`show run:<run-id>`、`show run:<run-id> --json` 与 Insight 的 Run debugger 都消费它，
不存在按粒度拆开的近义 Run operation。

```sh
niceeval show run:run_01JSHOW
```

`run.get` 按 exact `runId` 一次交付：

- Run/Experiment identity、state 与时间；
- expected/published/missing denominator，以及每个 Planned attempt 的 binding、Member state、Attempt locator 与 origin relation；
- Verdict、score、coverage、usage 状态与摘要，以及 issues 与 limitations。

### Planned attempt member

`run.get` 的 `plannedAttempts[]` 与 `experiment.get` / `overview.get` 的 `cells[].members[]` 使用同一个
`PlannedAttemptMember` 形状，读取同一个 Attempt 的代码在两处取到同一路径：

```ts
interface PlannedAttemptMember {
  readonly plannedAttemptId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  /** 只描述 binding：pending、absent（带 absenceReason）或 published。 */
  readonly publication: PlannedAttemptPublication;
  /** 以下结果字段与 publication 同级；未发布时为 null 或 unavailable MetricValue。 */
  readonly verdict: "passed" | "failed" | "errored" | "skipped" | null;
  readonly score: MetricValue;
  readonly costUSD: MetricValue;
  readonly durationMs: MetricValue;
  readonly tokens: MetricValue;
}
```

`publication` 只保留 binding 事实：`state`、`action`、`attemptId`、`attemptLocator`、`originRunId`、
`originPlannedAttemptId`，或 pending / absent 的 reason，不再嵌入 verdict 或指标。Attempt locator 只在
`publication.attemptLocator` 出现一次，member 上不再另放 `locator`。`run.get` 在同一 member 上追加
`relation`、`outcome`、`coverage`、`usage` 与 `limitations`；`experiment.get` 追加 `runId` 与 `labels`。
追加字段只增不改共享字段的位置。

decoder 只接受这一形状；缺少必填字段或带未知字段的 document 明确解码失败，而不是在旧路径上静默得到 `undefined`。

Run 已命中但 expected Member 未观测时，result 保留 `missing` Member 与不相等的 denominator。
partial、not-recorded 或 unavailable 的 score、coverage、usage 不按失败或零补齐。
这个 result 从 pinned facts 即时形成，不会作为 SQLite 派生表、缓存、Show DTO 或其它 artifact 持久化。

## machine 输出与错误面

`show --json` 与 `show --explain` 为投影调用的每个 operation 恰好向 stdout 写一行 canonical `InspectionDocument`。
document 不带协议名或版本号（[T-40](../../taste.md#t-40)）。其 `outcome` 穷尽为 `success | explanation | failure`。
success 编码 operation result，并带 source、`PublicationCutoff`、selection、limits、issues、Evidence 与 [`links`](#下一步与-links)。
explanation 交付同一 operation 的读取范围与 fact kinds。failure 交付 code、reason 与 correction。

`--explain` 对同一对象、方面与 ID 输出 explanation document：将读取的 source、selection、comparison mode 与 fact kinds，
不读取重 payload，让调用方在取大结果之前先看清范围。它总是输出 document，可与 `--json` 同写，不能与 `--all`、`--output` 同用。

库内 `selectInspectionOperation` 的 request 不通过 Schema 解码时，`inspection-request-invalid` 的 failure 附带 `issues`：每项给出 JSON Pointer 形式的 `path`、期望的类型或取值 `expected`，以及实际值的类型 `received`，不回显实际值本身。
`issues` 按出现顺序最多 20 项，超出时写明省略数量；`operation.kind` 本身无效时，第一项列出可用的 operation ID。
CLI 的对象、方面与 ID 不合法属于 argv 错误，见下文。

每个 source-bound success/explanation document 的 `source` 固定为
`{ kind: facts.kind, publicationCutoffIdentity: facts.cutoff().identity }`。
它不含路径。`PublicationCutoff` 只有 [Run 架构](../run/architecture/README.md#publicationcutoff) 定义的 `storeGeneration` 与 `revision`，不含 Run 计数；
codec 的 allowed/required fields、base envelope 与 `run.list` envelope 都使用这一形状。

这个 document 只属于 CLI 编码边界，不是 Insight 输入、View DTO、缓存或第二份持久
artifact。CLI、Web 与 Testkit 都从 `niceeval/inspection` 取得同一 Schema、类型与 decoder。Testkit 与 E2E 通过 `show --json` 或库内 `selectInspectionOperation` 取得 document，
只在完整 decode `InspectionDocument` 后按 `outcome` 和 operation 语义窄化，不维护宽松 JSON shape。浏览器不打开 facts、不运行 selector：View Host 在 Node 进程内执行同一 operation，经 HTTP 返回 document；浏览器不请求或反序列化 `show --json` stdout。

进度、argv 错误、无法验证 source，以及无法形成 document 的进程失败只写
stderr 并以非零状态退出。argv 错误包括未知对象前缀、方面与 ID 前缀冲突、ID 前缀不在表中和方面专属 flag 用错对象，诊断列出该对象可用的方面。
调用方不能根据 stderr 拼接部分 JSON，也不能把 stdout 的 document 与另一 source 或 cutoff 的页混合。

continuation token 绑定 operation、canonical request、source identity 与 `PublicationCutoff`。绑定
改变时，document 返回 restart correction；调用方必须去掉 `--continuation`，从同一条命令的第一页重新开始。

### 下一步与 links

每个输出都给出可以直接执行的下一步。文本输出末尾的 `Next` 打印完整可粘贴的命令，例如 `niceeval show @1RSAXZ5EHJH2V fc_3f90…`。
`--json` 的每个 success document 带 `links`：`{ rel, command }` 的数组，`command` 与文本 `Next` 中对应的命令逐字相同。

`rel` 是闭合枚举，agent 按 `rel` 选择下一步，不解析命令文本：

| `rel` | 指向 |
| --- | --- |
| `assertion` | 一条断言，`show @<locator> ae_<id>` |
| `diff` | Attempt 的改动列表，`show @<locator> diff` |
| `file-change` | 一个改动文件的 unified diff，`show @<locator> fc_<id>` |
| `execution` | Attempt 的执行 outline，`show @<locator> execution` |
| `execution-item` | 一项 trace 详情，`show @<locator> <trace 稳定 ID>` |
| `timing` | `show @<locator> timing` |
| `usage` | `show @<locator> usage` |
| `source` | `show @<locator> source` |
| `artifact` | 一项产物，`show @<locator> <产物 ID>` |
| `run` | `show run:<run-id>` |
| `attempt` | `show @<locator>` |
| `experiment` | `show exp:<experiment-id>` |
| `next-page` | 同一条命令加 `--continuation <token>` |

有字节上限的单个对象（执行证据、产物正文）超出一页时，result 带 `next-page` link：同一条 `show @<locator> <ID>` 命令加 `--continuation <token>` 读取下一段，token 绑定同一对象与同一读取 cutoff。
断言图片总是把完整字节写入 `--output` 指定的文件，不分页。

`links` 只列出这一份 result 已经暴露的稳定 ID，有界，不为了列链接额外读取事实。
每条命令原样执行都成功；agent 在命令后加 `--json` 得到下一份 document。带 `--record <file>` 读取时，命令保留同一个 `--record`。
文本 `Next` 另外可以给出 `niceeval exp <experimentId> --dry` 这类不属于读取的命令，它们不进入 `links`。
explanation 与 failure document 不带 `links`；failure 的下一步由 correction 表达。

## `niceeval show`

```sh
niceeval show [--reference] [--all] [--json]
niceeval show --record <file> [--json]
niceeval show exp:<experiment-id>... [--record <file>] [--json]
niceeval show exp:<experiment-id>... assertions [--eval <eval-id-prefix>] [--json]
niceeval show run:<run-id>... [--record <file>] [--json]
niceeval show runs [--continuation <token>] [--json]
niceeval show @<locator> [--json]
niceeval show @<locator> assertions [--json]
niceeval show @<locator> ae_<id> [--full] [--json]
niceeval show @<locator> ae_<id> image <image-id> --output <file>
niceeval show @<locator> source [--json]
niceeval show @<locator> execution [--actor <id>] [--type <event-type>] [--continuation <token>] [--json]
niceeval show @<locator> <trace 稳定 ID> [--json]
niceeval show @<locator> timing [--json]
niceeval show @<locator> usage [--reprice <pricing-file>] [--json]
niceeval show @<locator> diff [--json]
niceeval show @<locator> fc_<id> [--json]
niceeval show @<locator> artifacts [--json]
niceeval show @<locator> <artifact-id> [--json]
```

每一行都可以加 `--explain`（断言图片除外）。上表省略了可省的方面词：`show @<locator> diff fc_<id>` 与 `show @<locator> fc_<id>` 是同一条命令。

人在终端里找到想看的内容后，加 `--json` 就得到同一批数据的机器形态，把 `show` 换成 `view` 就在浏览器打开同一个位置；
三者用同一套对象、方面与 ID，不需要改写成另一种语法。默认输出文本，`--json` 输出结构化文档。

`show` 默认是英文 human text 入口。它打开 Node facts adapter，调用具名 Inspection operation，再格式化其闭合 result；`--json` 只换编码，不换 operation。

show 的每个投影只接受对应具名 operation 的 typed result；必填 shape 缺失时失败，只有契约
明示的 `null`、optional、`not-recorded` 或 `partial` 才能显示业务 fallback。

renderer 只能决定稳定顺序、终端宽度和文字布局。它不得重选成员，也不得重算
denominator、pass rate、score、coverage、usage、timing、diff 或 Evidence。宽度不足时可折行或截断已声明的 preview，
但不能改变成员、数值、状态或 omitted 数量。

### 固定投影

- 省略对象时调用 `project.get`，格式化当前 coverage、gaps、totals、Experiment summaries 与
  Experiment → Eval → Attempt table。

  Experiment ID 含 `/` 时，首段形成显示分组，组内 Experiment 与同前缀 Eval 使用相对标签。
  每个 Experiment 小节仍显示一次完整 ID，每个可下钻 Attempt 显示完整稳定 locator。

  默认 Attempt 明细隐藏没有问题的 `passed` 项；`failed` 必须按 Verdict 显示。每个 Experiment 最多展开 5 个 `errored` 项，超出的部分也折叠。
  gap、`skipped`、pending 与 absent 项始终可见。每个 Experiment 显示各结果的隐藏数量及可复制的
  `See more: niceeval show exp:<id>` 命令。

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
  当当前目标因配置或身份变更产生缺口，且存在对应历史 Attempt 时，当前状态仍忠实显示缺口，不将旧结果计入当前分数（[T-11](../../../taste.md#t-11)）。
  但在缺口明细下方，总览呈现独立的 `Reference results` 摘要，汇总对应历史 Attempt 的判定分布与参考得分。
  调用方亦可使用 `niceeval show --reference` 聚焦并展开这批历史已发布参照结果。
  有缺口时末尾给出 `Next: niceeval exp <experimentId> --dry`，每个有缺口的 Experiment 一行；没有缺口时省略 `Next`。
  完整形态见下文[当前 Results 示例](#当前-results-示例)。
- `Reference results` 摘要汇总每个带有历史 Attempt 的缺口，并写出 `Previous attempts N of K gaps`；没有历史 Attempt 的缺口不计入摘要。
  `Verdicts` 行总是出现。参照 Attempt 含 pass 制时显示 `Pass rate`，含 score 制时显示 `Score earned/possible`，两者都有时并排显示。
  缺口明细里的每条 `Previous result` 在 locator 后写出该 Attempt 的 Verdict；score 制再写出它的得分。
- 一个或多个 `exp:<id>` 逐个读取 exact `experiment.get`；任一 ID 未命中时整次失败。
  首先显示官方 costSummary 的实验总费用或已知小计、完整度和数量，再显示各评估结果与 Attempt 明细。
  范围是各计划 Attempt 最新已发布结果，明确标注 Latest recorded attempts；不表示全部历史支出或当前源码中的目标集合。
- 显式 `--record <file>` 省略对象时使用历史 `overview.get`，标题为 `Recorded results`；与 `exp:` 搭配时使用 exact `experiment.get`。
  这些路径不发现或求值当前项目。`run:` 与 Attempt locator 也始终读取固定历史事实。
- 一个或多个 `run:<id>` 逐个调用 exact `run.get`，并且只消费这一份闭合 result。
  它显示指定 Run 的 identity、时间、denominator、Member/Attempt locators、Verdict、score、coverage、usage 与 limitations。
  重复对象的输入顺序不是业务排序 authority。
- `@<locator>` 在同一读取 cut 调用 `attempt.get` 和 `attempt.usage`，首先显示该 Attempt 的总费用，再显示精确身份、Verdict、score、coverage、Assertion
  摘要、section states 与 limitations。`Next` 给出可复制的 assertions、source、execution、timing、usage 和 diff 命令。

  `attempt.get` 的 result 直接带 `diagnostics.items`：每项的 phase、code、有界 summary、是否截断与可展开的 Evidence ID。
  它回答“这个 Attempt 为什么是这个结果”，读者不必再调用 `attempt.trace`；文本视图的 Failure diagnostics 只渲染这个字段，`--json` 因此给出同一批诊断。

  `attempt.get` 的 result 带 `stoppedAt`，读自 Assertions entry 的 `control`：有 entry 为 `stopped` 时是 `{ state: "available", value: { entryId, label } }`；
  全部 entry 的 control 都已记录且没有 `stopped` 时 value 为 `null`；有 entry 为 `not-recorded`（升级前的 Record）且没有 `stopped` 时为 `{ state: "unavailable", reason: "not-recorded" }`。
  它不改变 Verdict；只停不 gate 的检查失败后 Verdict 仍可能是 `passed`。
  文本视图在 Verdict 下写 `Stopped at <label>; later steps did not run`，Experiment 与 Results 表在该 Attempt 的 Verdict 后标注 `stopped`。
  errored Attempt 的诊断阶段是 `sandbox.prepare`、`sandbox.command` 或 `agent.install` 时，诊断下方直接给出 `execution` 里对应命令输出的 `Next` 命令。
  overview 与 `execution` 的 `cache-degraded` 诊断显示具名降级 reason 与受影响的 Before 节点；若有远端调用错误，给出可展开的稳定 ID。
- `@<locator> assertions` 调用 `attempt.assertion.detail`，显示断言条目的判定、分值、结构化理由与聚焦证据。
  `@<locator> ae_<id>` 选择单项断言；默认以 compact 紧凑摘要交付，加 `--full` 包含完整原始材料与上下文行。
- `exp:<id>... assertions` 调用 `experiments.assertions`，按 Eval 把各 Experiment 的断言条目排成判据矩阵，见[跨 Experiment 的判据矩阵](#跨-experiment-的判据矩阵)。
- `@<locator> source` 调用 `attempt.sources`，显示已封存 source 与 Assertion facts，保留
  source state、location、limitations 与 Evidence；不从文本推断断言或运行时原文。
- `@<locator> execution` 调用 `attempt.trace` 显示有界 outline，展示块的呈现见下文[展示块呈现](#展示块呈现)。
  `@<locator> <trace 稳定 ID>` 按持久事件、证据、`itemId`、`toolOccurrenceId` 或 `commandId`
  直接调用 `attempt.trace.detail`。目标可以位于默认摘要之外。导入 key、原生 source eventId、
  `t<N>.c<M>`、`cmd<N>` 或数组位置不能替代持久身份；找不到时返回 selection error，不猜测相邻项。
  命令 outline 的 Outcome 写出退出码或终止原因；每条没有以退出码 0 结束的命令，在 Next 下给出可复制的
  `niceeval show @<locator> <commandId>`，展开后显示该命令完整保留的 stdout 与 stderr。
  错误摘要里的命令输出只是截断后的尾部，读者不必猜完整输出在哪（[T-31](../../taste.md#t-31)）。
- `@<locator> timing` 调用 `attempt.timing`，显示 activity 层级、phase、offset、duration、outcome、limitations 与 omitted count。
- `@<locator> usage` 调用 `attempt.usage`，首先显示该局 totalCosts，再显示应用用途、实际模型和 Judge 明细。全账本费用完整时显示 Total costs；存在缺项时显示 Known subtotal、Incomplete 和 Missing sources，不把已知小计称为整局价格。实验中的每个 origin Attempt 复用同一总费用投影，不累加分页预览。
  input/output token、request 与 cost typed totals 均保留各自 state/coverage。renderer 不得从 observations 聚合 totals，也不得将缺失或 omitted 按零补齐。
- `@<locator> diff` 调用 `attempt.diff`，显示已封存 window 与 file changes，并保留 binary、oversized、capture failure 等边界。
  每个正文可读的 text change 后给出 `Next: niceeval show @<locator> fc_<id>`。
- `@<locator> fc_<id>` 调用带 `changeId` 的 `attempt.diff`。result 带这一项的 before / after 正文与 Inspection 按两端正文算出的 unified hunks。
  正文与 hunks 各有字节上限，超出时写明截断位置；binary、oversized 与采集失败的一端如实标注，不伪造空正文。文本视图按 unified diff 显示。
- `@<locator> artifacts` 调用 `attempt.artifacts` 列出已保存的 artifact；`@<locator> <artifact-id>` 调用 `attempt.artifact` 读取一项。
- `@<locator> ae_<id> image <image-id> --output <file>` 调用 `attempt.assertion.image`，把图片字节写入 `--output` 指定的文件；
  `image` 必须跟在一条断言之后并与 `--output` 同用，不向终端写二进制。
- `@<locator> usage --reprice <pricing-file>` 调用 `attempt.reprice`，`<pricing-file>` 是下文[只读重计价](#只读重计价历史成本)的 `pricing` 对象。
- `runs` 调用 `run.list` 分页列出 Run；`--continuation` 读取下一页。

### 输出格式

默认输出上文的人读投影。`--json` 按下表的固定顺序，为投影调用的每个 operation 向 stdout 写一行 `InspectionDocument`（JSON Lines）。
每一行与库内 `selectInspectionOperation` 以同一 operation request 得到的 document 同一编码；全部行来自同一个 `PublicationCutoff`。

| 命令 | 依次调用的 operation |
| --- | --- |
| 省略对象 | `project.get` |
| 省略对象，带 `--record <file>` | `overview.get` |
| `exp:<id>...` | 每个去重后的 ID 一次 `experiment.get`，按 ID 排序 |
| `exp:<id>... assertions` | 一次 `experiments.assertions`，带全部去重后的 ID 与 `--eval` 前缀 |
| `run:<id>...` | 每个去重后的 ID 一次 `run.get`，按 ID 排序 |
| `runs` | `run.list` |
| `@<locator>` | `attempt.get`、`attempt.usage` |
| `@<locator> assertions` | `attempt.assertion.detail` |
| `@<locator> ae_<id>` | 带 `entryId` 的 `attempt.assertion.detail` |
| `@<locator> source` | `attempt.sources` |
| `@<locator> execution` | `attempt.trace`，带 `--actor`、`--type` 与 `--continuation` |
| `@<locator> <trace 稳定 ID>` | `attempt.trace.detail` |
| `@<locator> timing` | `attempt.timing` |
| `@<locator> usage` | `attempt.usage`；带 `--reprice` 时为 `attempt.reprice` |
| `@<locator> diff` | `attempt.diff` |
| `@<locator> fc_<id>` | 带 `changeId` 的 `attempt.diff` |
| `@<locator> artifacts` | `attempt.artifacts` |
| `@<locator> <artifact-id>` | `attempt.artifact` |

`--json` 不输出标题、表格、`See more`、`Next` 或浏览器提示，也不按 `--all` 改变内容：`--all` 只控制文本展开，因此不能与 `--json` 同用。
文本里的下一步在 document 中由 `links` 交付。
某个 operation 返回 `outcome: failure` 时，该行照常写出，后续 operation 不再调用，进程以非零状态退出。
argv 错误、source 无法打开等无法形成 document 的失败与文本模式一样只写 stderr。

`attempt.assertion.image` 只把字节写入文件，不接受 `--json`。输出格式没有其它选择参数。

### 在浏览器打开同一个 selection

文本模式在输出末尾给出一行 `Open: niceeval view <对象> [<方面>] [<ID>]`，对象、方面与 ID 与本次命令相同：省略对象时为 `niceeval view`。
方面专属 flag、`--all` 与 `--json` 不带入。`--record` 读取的是搬迁文件，没有对应的 View，省略这一行；断言图片与 `--reprice` 同样省略。
[`niceeval view`](../insight/cli.md#niceeval-view) 接受与 `show` 相同的对象、方面与 ID，打开对应位置。

### 展示块呈现

通用事件有展示块时，`show @<locator> execution` 按块呈现；没有展示块的事件显示 envelope 与 `summary`。

| kind | outline 中的呈现 |
|---|---|
| `text` | 原文，按终端宽度折行 |
| `message` | `<speaker 或 role 标签>: <text>` |
| `fields` | label 列按块内最长 label 对齐 |
| `code` | 等宽，不折行；超出终端宽度的行截断并标 `…` |
| `image` | `[image] <alt>`，次行媒体类型、大小与 `artifactId` |

outline 中有两种省略，标记不同：

- 文本超过预览上限时标为 `… (N more bytes: niceeval show @<locator> <eventId>)`，N 来自 Inspection result。
- `code` 行超过终端宽度时只标 `…`。这是显示宽度省略，源文本完整。

`show @<locator> <eventId>` 先显示完整展示块，再显示 payload JSON、links、scope 与 evidence。
展开后的 `code` 原样逐行输出，不折行、不截断、不加前缀，可以直接复制。
`image` 展开后另给出读取该附件的 `niceeval show @<locator> <artifactId>` 命令；终端不内联图像。

Events 的全部人读字符串按码点去掉控制字符与双向格式控制字符后再输出，包括 summary、actor label、limitation message 与展示块文本。

### 对象、方面与 flag 的组合

`@<locator>`、`run:` 与 `exp:` 不能混用；省略对象与 `runs` 也不与它们同写。`run:` 与 `exp:` 可各自重复，
重复值去重后由 Inspection 逐个 exact 选择。所有对象必须在同一 `PublicationCutoff` 上命中，命令才输出任何 section。

一条命令最多一个方面词。Attempt 方面只接受 `@<locator>`；`assertions` 另可跟在 `exp:` 之后；`run:`、`runs` 与省略对象不接受方面。

方面专属 flag 只与对应方面同用，其它组合是 argv 错误：

| flag | 只与 |
| --- | --- |
| `--actor`、`--type` | `execution`，分别交给 `actorId` 与 `eventType` |
| `--reprice <file>` | `usage` |
| `--eval <prefix>` | `exp:` 的 `assertions` |
| `--full` | 单条断言 `ae_<id>` |
| `--output <file>` | 断言图片 `image <image-id>` |
| `--continuation <token>` | 任何带 `next-page` link 的输出，原样交给 operation |
| `--reference` | 省略对象的当前结果 |
| `--all` | 省略对象的当前结果，且不与 `--json` 同用 |

`execution` 的下一页必须保留同一筛选；trace 稳定 ID 定位一项详情，不接受列表筛选，详情正文超出一页时同样用 `--continuation` 续读。

轨迹输出分别标明捕获状态、每条 trace 的 producer collection 状态及限制、当前页是否还有后续。
`partial` 的空索引显示其限制，页尾不能被描述为生产者证据完整。

## 比较两组 Run

```sh
niceeval compare <run-id>... -- <run-id>... [--mode paired|side-by-side|exact] [--max-regressions <n>] [--json]
```

`compare` 调用固定 Inspection 操作 `runs.compare`，比较两组已封口的 Run。`--` 左侧是对照版本，右侧是候选，各至少一项。
`--mode` 默认为 `paired`，亦可选 `side-by-side` 或 `exact`。`--json` 写一行 `runs.compare` 的 document，规则同 [machine 输出与错误面](#machine-输出与错误面)。

`paired` 模式按 `(evalId, attemptOrdinal)` 逐题配对，呈现两侧 Verdict、Score、Transition、得分差与成本差。
Transition 列区分 `stable-passed`、`stable-failed`、`regressed`、`improved` 与 `incomparable`。
指定 `--max-regressions <n>` 时，若退化题数超过门限则以非零退出，用于 CI 对照版本发布门禁（见 [REL-6](../../../user-story.md#周芷宁在发布前选出更合适的-agent-配置)）。
文本输出的 `Next` 与 document 的 `links` 指向两侧的 Run 与发生变化的 Attempt。

### 跨 Experiment 的判据矩阵

校准评分判据时，作者要回答三个问题：哪条判据在所有候选上都是零分或满分，哪条只在某个候选上丢分，哪条没有被求值。
单个 Attempt 的断言列表回答不了这些问题。`experiments.assertions` 在一个 `PublicationCutoff` 下读取一组 Experiment，
按 Eval 把它们的断言条目排成「判据 × Planned attempt」矩阵。

```sh
niceeval show exp:harness/v0.19.0 exp:harness/canary assertions
niceeval show exp:install/v0.20.0 exp:install/canary assertions --eval install/db-gpt
```

request 是 `{ kind: "experiments.assertions", experimentIds, evalIdPrefix? }`。`experimentIds` 至少一项，去重后按 ID 排序；
任一 ID 未命中时整次失败。`evalIdPrefix` 按 Eval ID 的路径前缀筛选，省略时包含全部 Eval。

成员选择与 `experiment.get` 完全相同：每个 Experiment 的每个 Planned attempt 取当前已发布结果。
这个 operation 不重新选择成员，不求值当前源码，也不把被替换的旧执行算进来。

result 按 Eval ID 排序，每个 Eval 给出：

- `columns`：每列是一个 `(experimentId, attemptOrdinal)`，带该成员的 locator、Verdict 与 score；没有已发布 Attempt 的列带闭合的 absence reason。
- `rows`：每行是一条判据，带 `label`、`groupPath`，以及与 `columns` 等长的 `cells`。
- `cells` 的每一格是该 Attempt 中这条判据的 `entryId`、判定结果与 contribution，取值与 `attempt.assertion.detail` 的同名字段相同；
  该 Attempt 没有这条判据时是 `absent`。
- `distinct`：这一行各列的判定结果与得分不全相同时为 `true`。只有一列时恒为 `false`。

行的身份是断言条目的 `groupPath` 加 `label`；没有 `label` 的条目不成行，
在该 Eval 的 `unlabeled` 里按列计数。同一 Attempt 内身份重复的条目不合并，按出现顺序成为同一行里的多格，
不能让后一条静默替换前一条。行按在各列中首次出现的顺序排列，先出现的列优先。

result 有界：行数或格数超过上限时 `state` 为 `partial`，并给出被省略的 Eval、行与列的数量；不能静默截断。

文本投影每个 Eval 一张表：第一行是各列的 Verdict 与 score，其后每行一条判据。计分条目显示 `得分/满分`，
不计分条目显示判定结果，`absent` 显示 `—`。`distinct` 为 `true` 的行有可见标记，标题下注明该标记的含义。
每列的表头给出 Experiment ID、Attempt 序号与 locator，读者可以直接复制 locator 下钻。

### 当前 Results 示例

默认 `show` 的 Experiment summary 显示 `Covered` 与 `Gaps` 列；Attempt 明细先列 gap，再列 `failed`、`errored`、
`skipped` 与 pending，`passed` 默认折叠：

```text
$ niceeval show
Current results
  Totals

  Covered    11/12
  Gaps       1
  Verdicts   8 passed; 3 failed; 0 errored; 0 skipped
  Pass rate  72.73% (partial)

Experiments
  Experiment  Covered  Gaps  Pass rate
  ----------  -------  ----  -----------------
  my-agent    11/12    1     72.73% (partial)

Attempts · my-agent
  Eval refund-policy
  Gap identity-mismatch
  Changed  source:evals/refund-policy.eval.ts (3f9a1c20 → b71e04d5)
  Previous result @1K1P0VJAPVJ12 (passed)

  Eval weather-tool
  Attempt         Verdict  Duration
  --------------  -------  --------
  @1MEMY3VCQ6B5B  failed   12.40 s

  8 passed Attempts hidden
  See more  niceeval show exp:my-agent

Next: niceeval exp my-agent --dry
Open: niceeval view
```

`Verdicts` 与 `Pass rate` 只统计 covered 位置，缺口不计 failed；有缺口时 Pass rate 的 state 是 `partial`，人读输出保留该标记。纯计分制范围显示 `Score` 而不显示 `Pass rate`，
规则同下文历史 Results。当前目标求值失败时不输出这张表，stderr 给出错误并提示 `niceeval show run:<run-id>`
等固定历史读取命令。

### 缺口写出变的是哪一项 {#缺口的变化}

带 `explanation` 的缺口在人读输出里紧跟一段说明，内容直接取自同一份 `IdentityExplanation`，不另行比较（[T-31](../../taste.md#t-31)）：

| `explanation.kind` | 说明行 |
|---|---|
| `changed` | 每条 delta 一行：`Changed  <selector> (<from> → <to>)`；`added` 与 `removed` 只写一侧的值并注明 `added` 或 `removed` |
| `unexplained` | `Unexplained  <diagnostic.summary>` |

一个缺口最多显示三条 delta，其余合成一行 `+N more`；完整列表由 `Next` 行的 `exp <id> --dry` 给出。
同一个 Experiment 的全部缺口说明相同时，说明只在 `Attempts · <experiment>` 标题下写一次并注明 `all N gaps`，各缺口不再重复。
说明相同指 delta 的数量、顺序、`selector`、`kind`、`from` 与 `to` 全部相等。
`from` 与 `to` 沿用差异说明的有界摘要；内容哈希显示前 8 位。其余 reason 没有说明行，它们的 reason code 已经写明原因。

### 全缺口与参照结果示例

当前目标因配置变动导致全部成员产生缺口，且存在可用历史 Attempt 时，总览呈现独立的 `Reference results` 参照区，并在末尾给出补跑规划指引。
score 制的参照 Attempt 写成 `Previous result @1FH9Y2RVQFPWN (failed, 34/72)`，参照区相应显示 `Score 61/144`：

```text
$ niceeval show
Current results
  Totals

  Covered    0/14
  Gaps       14
  Verdicts   0 passed; 0 failed; 0 errored; 0 skipped
  Pass rate  unavailable

Reference results (from previous recorded attempts)
  Previous attempts  14 of 14 gaps
  Verdicts           12 passed; 2 failed; 0 errored; 0 skipped
  Pass rate          85.71%
  Notice             Prior configuration; rerun required to update target

Attempts · install/canary
  Changed  config:agentInstalls (codex 0.144.1 → codex 0.167.2) · all 2 gaps

  Eval db-gpt
  Gap identity-mismatch
  Previous result @1Z2NDWH8SWVYJ (passed)

  Eval gpt-researcher
  Gap identity-mismatch
  Previous result @1EM9AT9SZYR96 (passed)

Next: niceeval exp install/canary --dry
Open: niceeval view
```

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
  See more  niceeval show exp:harness/canary --record ./results.json

  Experiment harness/v0.12.0
  1 passed; 1 failed Attempts hidden
  See more  niceeval show exp:harness/v0.12.0 --record ./results.json

Attempts · install
  Experiment install/canary
  Eval gpt-provider
  Attempt         Verdict  Duration  Score
  --------------  -------  --------  -----
  @1QD6PEMZY39P   errored  2.09 s    5

  1 passed Attempts hidden
  See more  niceeval show exp:install/canary --record ./results.json
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
  Attempt     attempt_01JSHOW · plannedAttempt-1
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
  niceeval show @01JSHOWATTEMPT assertions
  niceeval show @01JSHOWATTEMPT source
  niceeval show @01JSHOWATTEMPT execution
  niceeval show @01JSHOWATTEMPT timing
  niceeval show @01JSHOWATTEMPT usage
  niceeval show @01JSHOWATTEMPT diff

Open: niceeval view @01JSHOWATTEMPT
```

### Attempt 断言详情示例

`show @<locator> assertions` 呈现该 Attempt 各断言条目的判定、分值与理由。
每个条目的标记写它对结果起什么作用，读者不必读源码就知道哪一条决定了 Verdict（[T-23](../../taste.md#t-23)）：

| 标记 | 条目 | 取值 |
|---|---|---|
| `GATE` | `decision.gate` 不是 `not-gate` | `pass`、`fail`、`unavailable`、`n/a` |
| `SCORE` | `contribution` 是 `earned` 或 `unavailable` | `earned/points`；无法计算时写 `?/points` |
| `NOTE` | 既不是 gate 也不计分 | `met`、`unmet`、`unavailable`、`errored`、`n/a` |

同时是 gate 又计分的条目两个标记都写，`GATE` 在前。
`NOTE` 条目不影响 Verdict 与 score，包括只用 `.orStop()` 控制流程的条目；它的 `unmet` 不写成 `FAIL`。
计分条目不写 `PASS` 或 `FAIL`：零分与满分的区别由 `earned/points` 表达。

标题下第一行写 Verdict 与 score，第二行按作用计数；某一类没有条目时省略该段。
`Total N` 之类不分作用的合计不再出现。运行结束时的断言反馈与单条断言 `ae_<id>` 的标题使用同一组标记。
机器结果的字段不随人读标记改变。

```text
$ niceeval show @01JSHOWATTEMPT assertions
Assertions @01JSHOWATTEMPT
  Verdict failed · Score 3/6
  Gates 1 pass, 1 fail · Scored 4 · Notes 1 met, 1 unmet

  GATE  pass          candidate_installed · exact candidate version installed
  SCORE 1/1           file_created · package.json exists
  SCORE 2/2           syntax_valid · TypeScript compilation passed
  SCORE 0/2           docs_first · read the bundled index before editing
  GATE  fail  SCORE 0/1  lockfile_clean · package-lock.json matches dependencies
        Rationale: expected 15 packages in lockfile, observed 12.
        Target: package-lock.json
  NOTE  met           used_cli · ran the project CLI at least once
  NOTE  unmet         first_run_green · first run passed without a retry

Next: niceeval show @01JSHOWATTEMPT ae_5c8e2a0f7d3b1e6c9a4f --full
Open: niceeval view @01JSHOWATTEMPT assertions
```

追加 `--json` 原样交付结构化机器数据，文本 `Next` 中的命令出现在 `links` 里：

```text
$ niceeval show @01JSHOWATTEMPT assertions --json
{"outcome":"success", … ,"links":[{"rel":"assertion","command":"niceeval show @01JSHOWATTEMPT ae_5c8e2a0f7d3b1e6c9a4f --full"}, …]}
```

Experiment 对象是下钻动作，直接显示完整明细，不要求 `--all`：

```text
$ niceeval show exp:main
Experiment main
  Experiment total costs
  ……
  Scope      Latest recorded attempts; replaced executions excluded

  Summary

  Observed   3/3
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

Open: niceeval view exp:main
```

`exp:<id>` 读取该 Experiment 各计划 Attempt 最新已发布结果，不求值当前源码；当前缺口只在默认 `show` 中显示。

命令读取 project operational Store 的单一 `PublicationCutoff`。默认 `show` 在当前目标成功求值、Store 读取正常但没有历史结果时，正常返回 `Covered 0/N` 与 `Gaps N`。
当前目标求值失败、source 读取失败、显式 Run / Experiment / locator 未命中、required result shape 不合法与稳定 ID 未命中，都以英文诊断写 stderr 并非零退出。
不输出半张表，不把 typed missing/partial 或正常的当前缺口改写成进程失败。

`show` 不提供 `--report`、history、stats、fresh、grep 或自由 statistics，也不接受 Page、theme、
component、renderer、静态导出、显示位置 handle 或其它作者面。机器输出只有 `--json` 一种，它不新增 operation 或 result shape。
CLI 不探测 locale，只输出由 Inspection CLI presenter 直接拥有的英语文本，不建立中文或英语 message catalog。

读取失败保留底层 Record 错误分类、操作与原因。旧格式明确提示保留原存储后重新运行，不建议不存在的迁移命令；忙碌读取和资源限额表示本次读取未完成，不推断已发布数据损坏。

## Judge 用量与总费用

`attempt.usage` 的应用 calls/totals/modelGroups 与 Judge 账本分别呈现。judgeUsage 使用以下联合；experiment.get 的每个 origin Attempt 使用不含调用预览的 JudgeUsageSummary。
所有 number 计数为非负安全整数。TokenTotal 沿用 available/partial/unavailable、value:number|null、observationCount。

CostTotals 沿用应用的费用字段：state、source、values、totalCalls；每币种保留 coveredCalls、totalCalls 与 reported/estimated 计价依据。
JudgePriceReceipt 复用现有价格证明字段，只把 kind 定为 judge-call-price-estimate；不能出现 application 用途字段。

```ts
type JudgeUsage =
  | { state: "unavailable"; reason: "judge-usage-not-recorded" }
  | { state: "invalid"; reason: "judge-usage-source-invalid" }
  | {
      state: "complete" | "partial";
      coverage: "physical-transmissions";
      collection: CollectionState;
      calls: readonly JudgeUsageCall[];
      callsTruncated: boolean;
      omittedCallCount: number;
      totals: {
        requests: TokenTotal;
        inputTotalTokens: TokenTotal;
        outputTokens: TokenTotal;
        totalTokens: TokenTotal;
        costs: CostTotals;
      };
      priceReceipts: readonly JudgePriceReceipt[];
    };
```

JudgeUsageCall 的穷尽形状见 [Judge 账本定义](../judge/architecture.md#持久形状)。公开调用预览最多 128 条，按 entryIndex、logicalOrdinal、transmissionOrdinal 排序。
priceReceipts 仅返回预览调用的证明，全部证明仍留在附件。所有 totals 必须从全账本计算。

调用加对应价证按 canonical UTF-8 总字节选择完整前缀，预览最多 128 KiB；放不下一条时 calls=[] 且 omitted 为全量。
最终 attempt.usage envelope 超过 16 MiB 时继续缩短该前缀，不删 totals、完整度或已知金额；仍放不下才按既有预算错误拒绝。
截断必须同步 callsTruncated/omittedCallCount，不能只按行数限制。

请求计数只依赖登记完整性；token 和费用各自计算完整性。state complete 表示调用集合完整，不能替代指标完整度。
完整空账本的 requests/tokens 为已知 0、observationCount 0，costs complete 且 values=[]、totalCalls=0。

```ts
type JudgeUsageSummary =
  | Extract<JudgeUsage, { state: "unavailable" | "invalid" }>
  | Omit<Extract<JudgeUsage, { state: "complete" | "partial" }>,
      "calls" | "callsTruncated" | "omittedCallCount" | "priceReceipts">;

interface TotalCosts {
  state: "complete" | "partial" | "unavailable";
  values: readonly {
    currency: string;
    value: string;
    source: "reported" | "estimated" | "mixed";
  }[];
  missingSources: readonly ("application" | "judge" | "simulated-user")[];
  gaps: readonly CostGap[];
}

interface CostGap {
  source: "application" | "judge" | "simulated-user";
  reason:
    | "no-pricing-profile"          // 有 token，但 defineConfig.pricing 没有匹配这些模型的价格
    | "provider-cost-not-reported"  // adapter 没有交付逐次调用的费用或可计价的调用证据
    | "token-buckets-incomplete"    // 有价格，但缺计价所需的 token 分桶
    | "usage-not-recorded";         // 没有用量记录
  models: readonly string[];        // reason 为 no-pricing-profile 时列出缺价的 requestModel，否则为空
}
```

missingSources 固定 application、judge、simulated-user 顺序，无重复。任一 owner 不完整就列入；没有缺口为 complete。
每个 missingSources 成员在 gaps 里至少有一项说明原因；同一来源有多种原因时各占一项，按上面 reason 的顺序排列。
有缺口且有已知金额为 partial，否则 unavailable。完整但无收费调用可 values=[]，不伪造某个币种的零。
精确十进制按相同币种相加；不转换汇率。旧 application costUSD 和 totals.costs 不改为总成本。

旧应用缺源仍未知；合法完整空应用账本可在 totalCosts 判断为无应用收费调用，不更改旧应用 totals 的展示语义。

## 模型用途与成本

默认 `show @<locator>`、`show @<locator> usage` 与实验单局详情首先显示同一 totalCosts。
完整时显示 Total costs；存在缺项时显示 Known subtotal、Incomplete 与 Missing sources，不能把应用费用称为整局价格。

Missing sources 下逐项写出 gaps 的来源与原因。reason 为 `no-pricing-profile` 时，同一行给出缺价的模型，并在末尾给出
`Next: add prices for <models> to defineConfig({ pricing })` 与定价文档链接；其它原因说明补不上的是哪类证据，不建议填价。
完整空 Judge 账本显示 No Judge calls；缺账本显示 Judge usage unavailable；有调用但缺费用显示 Cost unavailable。
明确零费用显示币种、0、已知费用调用数和全部调用数；Judge 明细保留物理请求数、输入/输出/总 token 与各自完整度。

`show @<locator> usage` 区分模型配置、实际调用、应用费用、Judge 缺口与总费用已知小计。
单模型保持简洁摘要；多模型按用途逐行列配置模型、effort 和 recordedCalls，另表列实际 serving provider、model、调用数、tokens 与费用完整度。
只有全账本 recordedCalls 为 0 才标 no recorded calls；费用未知不显示成零，未调用配置不制造用量快照。

`show exp:<id>` 的 Models and usage 区按当前已选 origin Attempt 展示同一读面，标明 locator 和 origin Run。
重复 origin 只展示一次，不合并不同局的配置；超出 64 个 Attempt 时说明省略数，未找到的成员另列。
此区域不从调用或模型组预览重算实验总费用。旧应用 costUSD 口径不变，Judge 未登记与带缺口合计保持显式状态。

实验结果首先显示同一 `experiment.get.costSummary` 的总额、范围、唯一 origin 完整度与未定位计划 Attempt。
完整时为 Experiment total costs，否则为 Experiment known subtotal；不将这一范围称为某次 invocation 或全历史账单。
View 消费同一 Inspection 结果，保留中英 catalog，不解码 Provider 原文、不重算价格，也不累加显示预览。


## Notes

`show @<locator>` 在 Assertions 后展示 Notes，按调用顺序呈现 label 与 value；`null` 显示为 unavailable。
Quantity 使用其单位格式显示，例如 `512 ms`、`61.2%` 和 `$0.031`。
`show @<locator>` 加 `--json` 时，`attempt.get` document 在 Attempt 结果中返回 `notes`。

`show exp:<experiment-id>` 按 label 和 unit 分组展示数值 Note 的 count、min、median、p90、max。
JSON 对象、字符串、布尔值与 `null` 不参与这些数值统计。旧 Record 没有 Note 时返回空列表。

## 只读重计价历史成本

把价格表写入 pricing.json，再用 `niceeval show @<locator> usage --reprice pricing.json` 计算这个 Attempt 的只读估算。
pricing.json 的内容成为 `attempt.reprice` request 的 `pricing` 字段：

```json
{
  "provider/model": {
    "inputPerMTok": 2,
    "outputPerMTok": 8,
    "cacheReadPerMTok": 0.2,
    "cacheWritePerMTok": 2,
    "source": { "id": "comparison-prices-2026-10" }
  }
}
```

结果是本次价格表下的假设估算，历史结果和金额不变。比较 application、judge 与 total 的完整性后再使用金额；
partial 只代表已知小计。没有价格或调用证据不能按零费用比较。详细规则见[历史成本重计价](architecture.md#historical-repricing)。

## Sandbox State 查询

`run.get` 成功 document 的 `run.value.sandboxState` 使用 [RunSandboxState](../state/library.md#结果形状)。
`attempt.get` 的 `attempt.sandboxState` 使用同页的 AttemptStateResult；`state` 继续表示各自原有生命周期。
这些字段遵守同一 cutoff，包含全部实例世代，不从外部 checkpoint 推测事实。
