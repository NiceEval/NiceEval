# Record（持久事实层）→ Analysis（分析层）→ Report（报告层）

NiceEval 把不可恢复的运行事实、统计解释和结果呈现分成三层。普通用户通过 CLI（命令行界面）运行、查看、比较和迁移，不直接进入 `.niceeval`，也不接触 Record schema（持久事实格式）或执行 backend（执行后端）。

```text
┌──────────────────────────────────────────────────────────────┐
│ ③ Report（报告层）                                          │
│ Page / Report / Table / Bars / SourceView                   │
│ show 单目标 / view 与 static 全站                           │
│ （页面 / 报告 / 组件 / 终端 / 网页 / 静态站）               │
└──────────────────────────────▲───────────────────────────────┘
                               │ closed rows / MetricValue / DomainView
                               │ （闭合行 / 指标值 / 领域视图）
┌──────────────────────────────┴───────────────────────────────┐
│ ② Analysis（分析层）                                        │
│ Population / Dimension / Measure / Relation                 │
│ Query / executor                                            │
│ （总体 / 维度 / 度量 / 关系 / 查询 / 执行器）               │
└──────────────────────────────▲───────────────────────────────┘
                               │ RecordReadSession / RecordSelection
                               │ （惰性读取会话 / 事实选择）
┌──────────────────────────────┴───────────────────────────────┐
│ ① Record（持久事实层）                                      │
│ Assertions / source receipts / file changes / artifacts     │
│ lazy read / parallel append / seal / validate / migrate     │
│ （惰性读取 / 并行追加 / 封口 / 校验 / 迁移）                │
└──────────────────────────────────────────────────────────────┘
```

## 三层分别回答什么

| 层 | 心智模型 | 只回答的问题 | 详细入口 |
|---|---|---|---|
| ① Record（持久事实层） | 已发生事实的唯一账本 | 运行中发生了什么，current format 怎样读取、封口与维护 | [Record](../record/README.md) |
| ② Analysis（分析层） | 统计口径合同 | 事实怎样进入总体、分母、归并、比较和闭合结果 | [Analysis](../analysis/README.md) |
| ③ Report（报告层） | 可执行的阅读产品 | 查询结果怎样组成组件与页面，并呈现到终端、网页和静态站 | [Report](../reports/README.md) |

## Record 是固定协议，不是扩展机制

Experiment、Eval、Run、logical Slot 与 Attempt 是 NiceEval 的核心领域身份，不是 Analysis 作者可以重新定义的普通字段：

```text
定义面：ExperimentDefinition ──选择──▶ EvalDefinition

运行面：Invocation
          └─▶ Run
               └─▶ logical Slot
                    └─▶ Attempt
                         ├─ Assertions / Evidence
                         ├─ source receipts
                         ├─ file changes
                         └─ Artifacts
```

Record 固定这些实体的 identity（身份）、owner（归属者）、cardinality（基数）和引用关系。业务事实继续使用模块化 Attachment envelope（附件信封），但 Assertions、五个 Observability source、File Changes、Sources 与 Artifacts 的 family catalog 和 schema 只由 NiceEval 定义。它不提供 schema、字段或 migration registry（迁移注册表）。

用户不能定义另一种 Attempt、改变 Run→Attempt 关系，或把 runner activity 当作 Analysis result（分析结果）保存。NiceEval 需要新增不可恢复事实时，直接修改 Record 契约；不先抽象成未来可能开放的扩展 API。

公开作者面只有两类定义扩展：

1. Analysis：基于 NiceEval 发布的 Analysis input（分析输入）定义 Population、Dimension、Measure、Relation 或 DomainView。
2. Report：定义怎样把闭合分析结果组成组件、页面和呈现面。

Report 作者使用标准 React JSX。Host 可以在内部保留 `ResolvedPage`，但作者面不发布通用 semantic model，JSX 只交给 React 处理。

外部 Adapter（适配器）只能向 NiceEval 交付已解释、脱敏的 terminal Turn。raw tape、frame、provider payload 与 secret 不进入 Record。其它 capture authority 可以调用 NiceEval 已发布的 Runner、Sandbox、Artifact 或 diff collector（差异采集器），但不能注册新的 Record family（事实族）、迁移函数或物理字段。

## 核心术语与最小例子

| 术语 | 在本架构中的意思 | 最小例子 |
|---|---|---|
| `RecordReadSession`（事实读取会话） | ① Record 的 Scope-bound（资源作用域绑定）惰性 reader；按需读取和校验选中的 Run / Attempt | 查询 latency 时读取 Runner Activities，未查询的 File Changes 与 Evidence 不进入内存 |
| `RecordSelection`（事实选择） | ① Record 一次扫描后固定的 RunId、SlotId、预期分母和问题；不含完整 payload | Run A 与 Run B 的身份和 logical Slot 集合 |
| `RunWriteSession`（运行写会话） | ① Record 中只写一个新 RunId 的能力 | 一个 `niceeval exp` 创建 Run，并并行创建自己的 Attempt 后封口 |
| `AnalysisInput`（分析输入） | ② Analysis 公开的只读输入能力；由 NiceEval 从当前 Record schema 发布 | `attemptLatencyMs` 从 Runner Activities 投影出毫秒数，但不暴露 source receipt |
| `Population`（总体） | ② Analysis 要解释的完整成员集合 | 一次实验预期运行的 10 个 logical slot（逻辑槽位） |
| `Dimension`（维度） | 用来分组或标识总体成员的字段 | `model = "gpt-5"`、`condition = "memory-on"` |
| `Measure`（度量） | 一次声明归并、分母、缺失和证据规则的统计口径 | 通过率以 10 个预期 slot 为分母，而不是只数 8 个有结果的 slot |
| `SemanticFrame`（语义数据帧） | 高级 `query()` 的闭合表格结果；中立组件只接收它转换后的 rows | 每行是一组维度坐标，每个度量单元仍是完整 `MetricValue` |
| `DomainView`（领域视图） | 不能压成规则表格的闭合领域结构 | 某个 Attempt 的 activity 树、命令时序或 Evidence 详情 |
| `ResolvedPage`（私有已求值页） | ③ Host 在固定 Sample 存活时短存的单目标 Page 值 | `show` 选中 Overview 或一个 Attempt 详情页后交付文字或机器文档；它不是作者 API 或站点版本 |
| `ClosedSiteRevision`（闭合站点版本） | ③ view 与 static 在全站枚举、校验后共用的最终页面、asset 和下载 bytes | Overview、Comparison 与全部枚举的 Attempt 详情页；view HTTP 与静态目录读取相同 route body |

`SemanticFrame` 不是 Record 物理表，也不是只装数字的普通 DataFrame（数据帧）。例如按模型比较通过率时，一行可以是：

它也不是 `defineSemanticFrame()` 产生的定义。Analysis 作者先用 `definePopulation()`、`defineDimension()` 和 `defineMeasure()` 声明统计语义。随后 `query(sample, request)` 从同一 `RecordSelection` 选中的一个或多个 Run 惰性计算出 `SemanticFrame`；结果可以随时重算，不写回 Record。

```text
RecordReadSession（惰性事实读取会话）
        │ reader.selectRuns(request)
        ▼
RecordSelection（事实选择）
        │ analysis.openSample({ reader, selection })
        ▼
Sample（样本）
        │ query(sample, { by, measures })
        ▼
SemanticFrame（语义数据帧）
```

```ts
{
  key: "model:gpt-5",
  model: "gpt-5",
  passRate: {
    value: 0.8,
    state: "partial",
    samples: 8,
    total: 10,
    basis: "slot",
    issues: [{ code: "missing", members: 2 }],
    refs: [/* exact Attempt locators（精确尝试定位符） */],
  },
}
```

这行表示“预期 10 个 slot，8 个实际贡献，通过率按既定口径得到 0.8，另有 2 个缺失”。Report 先取得 `frame.rows`，再把闭合 rows 交给 `Table` 或 `Bars`；组件不得只拿 `0.8` 再猜分母。

`DomainView` 保留树或时序。例如 Timing View 包含父子 activity、开始结束时间、问题和 Evidence refs；把它写入 `SemanticFrame` 会丢失层级，所以交给领域组件而不是中立图表。

## Matcher Filter Debugger 的跨层闭合

Matcher Filter Debugger 由 Analysis 发布具名 composite `MatcherFilterDebuggerView`。它一次组合 Assertions 的 query artifact 与 source owner 的 tool／event ledger。这个视图交付 Query summary、权威聚合计数、source-owned ledger、coverage-aware assertion overlay 和 selected-row detail。Report 只消费这一个闭合 DomainView。

Record source owner 为每条独立事件持久化 `eventId`，为每笔 logical tool occurrence 持久化 `toolOccurrenceId`，并保存准确的 scope relation 与 `scopeId`。`operation.started` 和 `operation.finished` 的 `eventId` 不同；属于同一生命周期时，它们共享 `toolOccurrenceId`。Agent Turns 中 producer-minted `callId` 只表达 producer 配对输入，不能替代这些跨 family identity。

tool lifecycle 可以跨 Turn。source owner 分别保存 started／finished 的 Turn relation，并让同一个 `toolOccurrenceId` 连接两端；Analysis 不能把 lifecycle 归入单个 Turn，也不能按时间邻近配对。Assertions 只持久化 bounded locators、receipt、witness path 或 `failure frontier`，不复制 ledger。

Analysis 只在 `eventId`、`toolOccurrenceId`、scope relation 与 `scopeId` 能精确验证时建立 overlay。它把 source collection、evaluation receipt、identity relation 和 overlay retention 分别留在 `MatcherFilterDebuggerView` 中。React component 不接收两组待 join 的数组，不按位置 zip，也不按名称、时间或人类编号猜关系。

历史 Record 若能形成 ledger，却没有 Assertion locator 或准确 scope relation，Analysis 仍返回中立 ledger，并把 identity relation 标为 unavailable。Report 显示 `会话已记录 N 条，但此历史 Record 未保存断言与记录的逐条关联`。source partial、observability unavailable 与 retained old diagnostics 保持为三个独立状态；任何读侧都不重跑 matcher，也不把旧 diagnostic 与 ledger 合并推断。

## 什么可以定义成 Measure

Record 中的数字不自动等于指标。建议使用三个不同术语：

```text
Observation field（观测字段）  activity.durationMs = 412    Record 事实
Measure definition（度量定义） mean latency per logical slot Analysis 口径
MetricValue（指标值）           value / state / samples / total  query 输出
```

一个自定义 Measure 必须满足：

- 输入来自 NiceEval 发布的 `AnalysisInput`，也就是对当前 Record schema 的稳定只读投影；
- 明确 Population、三段归并、denominator、missing 和 Evidence policy；
- 计算是纯的、可重复的，不读取网络、当前文件或当前时间；
- 返回的 `MetricValue` 保留 state、samples、total、basis、issues 与 refs。

可以基于已发布输入定义通过率、平均延迟、P95 token usage、tool-call failure rate 和每个 model 的 Judge score。`model`、`condition` 这类分组字段应定义为 Dimension；Runner Activities、Agent Turns 和 File Changes 应保留为 Record fact，并按需投影为 `DomainView`，不应伪装成 Measure。若 NiceEval 没有发布 GPU 能耗输入，用户不能仅靠 `defineMeasure()` 把它写进 Record；必须先修改 NiceEval 的固定 Record schema，并发布对应 Analysis input。

Query（查询）、`SemanticFrame`（语义数据帧）和 `DomainView`（领域视图）由 Analysis 拥有。Components（组件）、Page（页面）、terminal/Web/static renderer（终端 / 网页 / 静态渲染器）由 Report 拥有。NiceEval 不建立 `niceeval/fact`、`niceeval/query`、`niceeval/view`、`niceeval/components` 或 `niceeval/delivery` 公共入口。

## 作者 API 与宿主 SDK

```text
作者定义面                                      宿主操作面

"niceeval"                                     "niceeval/experiment/host"
defineEval() / t.check()                         experimentHost.list / plan / run / accept
Assertion-first（断言优先）                              │
        │                                               │
"niceeval/analysis"                                    │
definePopulation / defineMeasure / query                 │
        │                                               │
"niceeval/report"                              "niceeval/report/host"
defineReport / defineComponent / aggregate       reportHost.show / serve / export
Table rows / Bars points / MetricValue

宿主基础能力
├─ "niceeval/record/host"        recordHost.openRead / createRun / createReferenceRun / maintenance
└─ "niceeval/coordination/host"  coordinationHost.claimExecution / record leases
```

CLI 不经过一个包办所有命令的统一中转层。每条命令直接调用拥有该用例的窄 Host SDK（宿主开发工具包）。Experiment 与 Coordination 是操作 SDK，不是第四、第五个数据层；它们不拥有 Record 事实、Analysis 结果或 Report tree（报告树）。

| owner | Host SDK 入口 | API |
|---|---|---|
| Experiment 操作 | `niceeval/experiment/host` | `experimentHost.list()`、`plan()`、`run()`、`accept()` |
| Coordination 操作 | `niceeval/coordination/host` | `coordinationHost.claimExecution()`、`enterRecordRead()`、`enterRecordAppend()`、`enterRecordMaintenance()` |
| ① Record | `niceeval/record/host` | `recordHost.openRead()`、`createRun()`、`createReferenceRun()`、`maintenance()` |
| ② Analysis | `niceeval/analysis/host` | `analysisHost.openSample({ reader, selection })`；`query()` 仍由 `niceeval/analysis` 拥有 |
| ③ Report | `niceeval/report/host` | `reportHost.show()`、`serve()`、`export()` |

三层的公开职责不同：

| 层 | 用户可以定义什么 | 这一层执行什么 |
|---|---|---|
| ① Record | 无；schema 和写入操作固定 | 惰性读取、创建独立 Run / Attempt、封口和显式迁移 |
| ② Analysis | Population、Dimension、Measure、Relation；从已发布 `AnalysisInput` 选择输入 | `aggregate()` 与 `query()` 计算闭合 rows、`SemanticFrame` 或 `DomainView`，并共享同一套统计语义 |
| ③ Report | 两种 `defineComponent()` 与 `defineReport({ pages })` | 中立组件消费 rows / points / `MetricValue`；show 执行目标页，view/static 构建完整站点版本 |

## 每条命令从哪里读、向哪里写

下面省略 CLI handler 与宿主编排胶水，只画真正拥有数据的层及其 exact API（精确接口）。`read` 表示读取，`write` 表示持久写入。

### `niceeval exp list`

```text
read  ──▶ Experiment Host SDK：experimentHost.list()
write ──▶ 无

不调用 ① Record、② Analysis 或 ③ Report。
```

### `niceeval exp --dry`

```text
read  ──▶ Experiment Host SDK：experimentHost.plan(request)
              └─▶ ① Record Host SDK：record.openRead()
                     reader.selectRuns(historySelection)
write ──▶ 无

读取是惰性的；只扫描已封口 Run 的最小 Core，不读取全部 Attempt payload。
```

### `niceeval exp`

```text
read  ──▶ Experiment Host SDK：experimentHost.run(plan)
              └─▶ ① Record Host SDK：record.openRead() 惰性复查 reuse
write ──▶ ① Record Host SDK：record.createRun(core)
              ├─▶ run.createAttempt(slot)；多个 Attempt 可并行
              ├─▶ Attempt 固定事实写入 API
              └─▶ run.seal(completion)

并发：Coordination SDK 在派发每个 Slot 时 `coordinationHost.claimExecution(key)`；不同 Run writer 不互斥。
```

### `niceeval accept @<locator>...`

```text
read  ──▶ Experiment Host SDK：experimentHost.accept(request)
              └─▶ ① Record Host SDK：record.openRead()
                     reader.selectRuns(exactLocators)
write ──▶ ① Record Host SDK：record.createReferenceRun(core)
              ├─▶ run.referenceAttempt(slot, selectedAttempt)
              └─▶ run.seal(completion)

并发新 Run 不会修改被引用 Attempt；seal 时重新验证精确引用仍是完整事实。
```

### `niceeval show`

```text
read  ──▶ ① Record Host SDK：record.openRead() / reader.selectRuns()
          ② Analysis Host SDK：analysis.openSample({ reader, selection })
             Report facade：aggregate(sample, ...) / 具名 DomainView 投影
          ③ Report Host SDK：reportHost.show()
write ──▶ 无

结果：ReportShowOutput（报告显示输出）。它只包含选中 route 的 text 或机器文档，不枚举参数 Page，也不形成站点版本。
```

### `niceeval view`

```text
read  ──▶ ① Record Host SDK：record.openRead() / reader.selectRuns()
          ② Analysis Host SDK：analysis.openSample({ reader, selection })
             Report facade：aggregate(sample, ...) / 具名 DomainView 投影
          ③ Report Host SDK：reportHost.serve()
write ──▶ 无

每次 rebuild（重建）先枚举全部 Page 并形成完整 `ClosedSiteRevision`，随后关闭惰性 reader；浏览器导航只读 revision bytes。
```

### `niceeval view --out <directory>`

```text
read  ──▶ ① Record Host SDK：record.openRead() / reader.selectRuns()
          ② Analysis Host SDK：analysis.openSample({ reader, selection })
             Report facade：aggregate(sample, ...) / 具名 DomainView 投影
          ③ Report Host SDK：reportHost.export()
write ──▶ ③ Report Host SDK：只写目标静态目录，不写 Record

Record reader 在完整 `ClosedSiteRevision` 形成后关闭，随后才写目标目录；目录页面与 view HTTP body 使用相同 bytes。
```

### `niceeval migrate`

```text
read  ──▶ ① Record Host SDK：recordHost.maintenance().inspect()
                         maintenance.planMigrate()
            └─▶ Coordination SDK：释放 maintenance lease 并请求用户授权
write ──▶ ① Record Host SDK：recordHost.maintenance()
                         maintenance.applyMigrate()

应用前重新取得 exclusive maintenance lease（独占维护许可），检查 Git、Record、源格式和 NiceEval 版本；计划身份变化时不写盘。应用后按相邻版本原地改写。
```

运行和采用由 Experiment Host SDK 编排，并调用 ① Record 的窄写入 API；并行去重进入 Coordination SDK，不进入 Record。迁移只调用 Record maintenance。查看与导出才依次读取 ①②③。

## 数据怎样穿过三层

```text
Assertion producer / Adapter / SessionManager / Sandbox / Runner / collectors
                          │
                          ▼
AttemptWriteSession → Run seal → runs/<RunId>/complete
                                      │
                         record.openRead()（惰性）
                                      │
                         reader.selectRuns(request)
                                      ▼
                          Sample
                                      │ aggregate() / 具名 DomainView 投影按需读取
                                      │
                       ClosedRows / MetricValue / DomainView
                                      │
                                      ▼
                              Pages / Components
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   show：selected Page → private ResolvedPage      view/static：all Page instances
                 │                                         │
                 ▼                                         ▼
          terminal / target JSON                   ClosedSiteRevision → Web / static site
```

Record 只保存无法从已有事实重新计算的内容。通过率、均值、排名、denominator（分母）、missing（缺失）汇总、图表点位与页面树都由上层按定义重新形成。
current catalog 固定为九个 family；每个 family 自己拥有稳定 identity、owner 与 numeric `schemaVersion`。

## Record 数据边界

| 数据 | 进入 Record 的方式 | 持久边界 |
|---|---|---|
| AssertionResult / Evidence | Assertion producer 自动封口 | 固定 `niceeval.assertions` Attachment 与有界 Evidence refs（证据引用） |
| terminal Turn、tool／event ledger 与 provider usage observation | Adapter 先解释、归一和脱敏协议输入，source owner mint ledger identity | Attempt-owned `niceeval.agent-turns`；持久化 `eventId`、`toolOccurrenceId`、scope relation／`scopeId`，不含 raw tape、frame 或 secret |
| 物理 send 的 source context | SessionManager 在每个 `t.send` 保存 capture-time anchor | Attempt-owned `niceeval.turn-contexts` |
| command lifecycle 与安全 stream | Sandbox wrapper 在调用和结束边界采集 | Attempt-owned `niceeval.sandbox-commands` 与自身 stream blob closure |
| owner-local activity | Runner monotonic clock 或可证明归属的 OTel capture input | Attempt 或 Run-owned `niceeval.runner-activities`；不含 raw OTLP |
| advisory 与 execution error | Runner diagnostic sink 封口 | Attempt 或 Run-owned `niceeval.runner-diagnostics` |
| 文件差异 | Sandbox diff collector（沙箱差异采集器） | 固定 `niceeval.file-changes` Attachment；大型内容进入本 family 的 blob closure |
| 源码闭包 | Runner 在 origin Run 封口前采集 | 固定 `niceeval.sources` Attachment 与自身 blob closure |
| 大型文件 | NiceEval 发布的 Artifact collector | 固定 `niceeval.artifacts` Attachment 保存媒体类型、身份与 blob 引用 |

Adapter 只能向 NiceEval 已发布的 collector 提交合法值，不能借此建立第三方 schema。

conversation、usage、commands、timing 与 diagnostics 由 Analysis 从对应 source 投影。source navigation 是
`turn-contexts`、`runner-activities` 与 origin Run `niceeval.sources` 的 Fact relation，不是第十个 family。
Matcher Filter Debugger 同样只是 Assertions 与 source ledger 的 composite DomainView，不新增持久 family。

Record 固定每个事实族的 payload shape（载荷形状）、owner（所有者）与语义。改变 Attachment 字段类型、scope（作用域）、cardinality（基数）、单位或坐标域时，需要提高该 family 的 `schemaVersion` 并提供可信相邻 migration；改变 Core 或发布边界时使用新的 format identity。显示名、格式、颜色、统计口径和组件配置不属于持久 schema。

## Migration（迁移）边界

Record 只向上层提供 current schema。root 使用稳定的 `niceeval.record.source-receipts` format identity；数值版本
只属于各 Attachment envelope。已知 family 只有具备固定、完整相邻 chain 时才能在 current format 内维护，
普通 reader 永远不会静默改盘。

旧 `niceeval.record` beta format 及其 `niceeval.observability` aggregate 明确返回 `unsupported-format`。它没有
可证明的 capture authority 与 segment provenance，不能拆成五个 source receipt，也不能伪造 source-navigation
relation。用户需要用写出该格式的 NiceEval 版本读取。

版本识别、具体 converter（转换函数）、Git preflight（Git 预检）、`migration.in-progress` 与最终校验属于 Record Host SDK（持久事实宿主开发工具包）。maintenance 只运行已声明 family 的可信相邻步骤；未知 family、future schemaVersion、不相容 Core 或缺少完整 chain 都拒绝打开。

Git 负责恢复历史 portable bytes。maintenance 用 local staging 与 `migration.in-progress` 约束可证明的恢复边界，
不把 backup、rollback 或恢复日志写进 portable Record。迁移失败后，只有验证 worktree 与 index 等于已绑定的
restore commit，才能清除 sentinel 并重新迁移。

新增 Query、Measure、组件、Page 或 renderer 不能推动 Record schema 升版。只有新增不可恢复事实、修复无法正确解释的持久语义，或改变必须原子提交的事实关系时，才允许新增显式 migration。

## SQL（结构化查询语言）边界

SQL 不是 Record 与 Report 之间的公共层。Analysis 作者提交 typed query（类型化查询），Report 作者只消费闭合结果。

```text
typed query（类型化查询）
        ▼
QueryPlan（查询计划）
        ├─ TypeScript executor（TypeScript 执行器）
        └─ optional DuckDB executor（可选 DuckDB 执行器）
```

DuckDB 只能位于 `QueryPlan` 的实现阶段。它不能定义 population、denominator、missing、retry 或 Evidence 口径，也不能把 Record 物理表暴露给 Report 作者。

## 全局不变量

1. Record 只持久化不可恢复的事实，不保存 Analysis 或 Report 派生结果。
2. Record schema、writer、migration 和物理布局只由 NiceEval 定义；不存在扩展 registry。
3. Record 根没有可变全局 manifest、递增编号、权威 latest 或全局 writer lock；每个 writer 只写自己的 RunId。
4. `RecordReadSession` 惰性读取；`RecordSelection` 只固定身份、分母与问题，不保存完整事实副本。
5. Analysis 独占 population、denominator、missing、reduction 与 relation 语义。
6. Report 中立组件只消费闭合 rows、points 与 `MetricValue`；领域组件只消费闭合领域值。
7. `show` 只执行选中 Page；view 与 static 从同一个完整 `ClosedSiteRevision` 读取相同的 route、asset 与下载 bytes。
8. scalar（标量）丢失 state、samples、total、basis、issues 或 refs 后，不能重新包装成 `MetricValue`。
9. 新查询、新组件和新输出媒介不会要求 Record migration。

## 文档入口

每层的 README 定义心智模型与边界；`library.md` 是 API、类型、状态与错误的唯一契约；`use-case/` 展示完整组合路径。

| 层 | 心智模型 | API 契约 | 完整路径 |
|---|---|---|---|
| Record | [README](../record/README.md) | [Library](../record/library.md) | [Use case](../record/use-case/README.md) |
| Analysis | [README](../analysis/README.md) | [Library](../analysis/library.md) | [Use case](../analysis/use-case/README.md) |
| Report | [README](../reports/README.md) | [Library](../reports/library.md) | [Use case](../reports/use-case/README.md) |
