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
│ Assertion / OTel / events / file diff                       │
│ lazy read / parallel append / seal / validate / migrate     │
│ （惰性读取 / 并行追加 / 封口 / 校验 / 迁移）                │
└──────────────────────────────────────────────────────────────┘
```

## 三层分别回答什么

| 层 | 心智模型 | 只回答的问题 | 详细入口 |
|---|---|---|---|
| ① Record（持久事实层） | 已发生事实的唯一账本 | 运行中发生了什么，旧格式怎样显式迁移为当前格式 | [Record](../record/README.md) |
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
                         ├─ OTel spans / events
                         ├─ file changes
                         └─ Artifacts
```

Record 固定这些实体的 identity（身份）、owner（归属者）、cardinality（基数）和引用关系。业务事实继续使用模块化 Attachment envelope（附件信封），但 Assertions、OTel、event、file changes 与 Artifact 的 family catalog 和 schema 只由 NiceEval 定义。它不提供 schema、字段或 migration registry（迁移注册表）。

用户不能定义另一种 Attempt、改变 Run→Attempt 关系，或把 OTel event 当作 Analysis result（分析结果）保存。NiceEval 需要新增不可恢复事实时，直接修改 Record 契约并提供具体迁移；不先抽象成未来可能开放的扩展 API。

公开作者面只有两类定义扩展：

1. Analysis：基于 NiceEval 发布的 Analysis input（分析输入）定义 Population、Dimension、Measure、Relation 或 DomainView。
2. Report：定义怎样把闭合分析结果组成组件、页面和呈现面。

Report 作者使用标准 React JSX。Host 可以在内部保留 `ResolvedPage`，但作者面不发布通用 semantic model，JSX 只交给 React 处理。

外部 Adapter（适配器）可以调用 NiceEval 已发布的 OTel、事件、Artifact 或 diff collector（差异采集器），但不能注册新的 Record family（事实族）、迁移函数或物理字段。若一种新事实值得持久化，先进入 NiceEval 的领域设计与版本治理。

## 核心术语与最小例子

| 术语 | 在本架构中的意思 | 最小例子 |
|---|---|---|
| `RecordReadSession`（事实读取会话） | ① Record 的 Scope-bound（资源作用域绑定）惰性 reader；按需读取和校验选中的 Run / Attempt | 查询 latency 时读取 OTel，未查询的 diff 与 Evidence 不进入内存 |
| `RecordSelection`（事实选择） | ① Record 一次扫描后固定的 RunId、SlotId、预期分母和问题；不含完整 payload | Run A 与 Run B 的身份和 logical Slot 集合 |
| `RunWriteSession`（运行写会话） | ① Record 中只写一个新 RunId 的能力 | 一个 `niceeval exp` 创建 Run，并并行创建自己的 Attempt 后封口 |
| `AnalysisInput`（分析输入） | ② Analysis 公开的只读输入能力；由 NiceEval 从当前 Record schema 发布 | `attemptLatencyMs` 从 OTel record 投影出毫秒数，但不暴露原始 spans |
| `Population`（总体） | ② Analysis 要解释的完整成员集合 | 一次实验预期运行的 10 个 logical slot（逻辑槽位） |
| `Dimension`（维度） | 用来分组或标识总体成员的字段 | `model = "gpt-5"`、`condition = "memory-on"` |
| `Measure`（度量） | 一次声明归并、分母、缺失和证据规则的统计口径 | 通过率以 10 个预期 slot 为分母，而不是只数 8 个有结果的 slot |
| `SemanticFrame`（语义数据帧） | 高级 `query()` 的闭合表格结果；中立组件只接收它转换后的 rows | 每行是一组维度坐标，每个度量单元仍是完整 `MetricValue` |
| `DomainView`（领域视图） | 不能压成规则表格的闭合领域结构 | 某个 Attempt 的 span 树、事件时序或 Evidence 详情 |
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

`DomainView` 保留树或时序。例如 `TraceView`（追踪视图）包含父子 span、开始结束时间、问题和 Evidence refs；把它写入 `SemanticFrame` 会丢失层级，所以交给 `TraceViewer`（追踪查看器）而不是中立图表。

## 什么可以定义成 Measure

Record 中的数字不自动等于指标。建议使用三个不同术语：

```text
Observation field（观测字段）  span.durationMs = 412.8      Record 事实
Measure definition（度量定义） mean latency per logical slot Analysis 口径
MetricValue（指标值）           value / state / samples / total  query 输出
```

一个自定义 Measure 必须满足：

- 输入来自 NiceEval 发布的 `AnalysisInput`，也就是对当前 Record schema 的稳定只读投影；
- 明确 Population、三段归并、denominator、missing 和 Evidence policy；
- 计算是纯的、可重复的，不读取网络、当前文件或当前时间；
- 返回的 `MetricValue` 保留 state、samples、total、basis、issues 与 refs。

可以基于已发布输入定义通过率、平均延迟、P95 token usage、tool-call failure rate 和每个 model 的 Judge score。`model`、`condition` 这类分组字段应定义为 Dimension；原始 OTel span、事件时序和文件 diff 应保留为 Record fact，并按需投影为 `DomainView`，不应伪装成 Measure。若 NiceEval 没有发布 GPU 能耗输入，用户不能仅靠 `defineMeasure()` 把它写进 Record；必须先修改 NiceEval 的固定 Record schema，并发布对应 Analysis input。

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
Assertion-first API / OTel bridge / Adapter / diff collector
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
五个固定 family 名是稳定 identity；下表 Attachment envelope 的 `schemaVersion` 均为 `1`。

## Record 数据边界

| 数据 | 进入 Record 的方式 | 持久边界 |
|---|---|---|
| AssertionResult / Evidence | Assertion producer 自动封口 | 固定 `niceeval.assertions` Attachment 与有界 Evidence refs（证据引用） |
| OTel | Adapter 或平台 bridge 提交给 Attempt 的固定 collector（采集器） | 固定 `niceeval.observability` Attachment |
| 文件差异 | Sandbox diff collector（沙箱差异采集器） | 固定 `niceeval.file-changes` Attachment；大型内容进入本 family 的 blob closure |
| 源码闭包 | Runner 在 origin Run 封口前采集 | 固定 `niceeval.sources` Attachment 与自身 blob closure |
| 大型文件 | NiceEval 发布的 Artifact collector | 固定 `niceeval.artifacts` Attachment 保存媒体类型、身份与 blob 引用 |

Adapter 只能向 NiceEval 已发布的 collector 提交合法值，不能借此建立第六种 schema。

Record 固定每个事实族的 payload shape（载荷形状）、owner（所有者）与语义。改变字段类型、scope（作用域）、cardinality（基数）、单位或坐标域必须发布下一 Record 版本和具体 migration。显示名、格式、颜色、统计口径和组件配置不属于持久 schema。

## Migration（迁移）边界

Record 只向上层提供当前 schema。`Record Core v1` 与五个 fixed family 的 `schemaVersion: 1` 构成第一版正式协议，当前 migration chain（迁移链）为空。

```text
Record v1（第一版正式事实集）
        │ 未来发布 v2 时同时提供 v1 → v2
        ▼
Current Record v2（届时的当前事实集）
        │
        ▼
Analysis（分析层）
```

版本识别、具体 converter（转换函数）、Git preflight（Git 预检）、`migration.in-progress` 与最终校验属于 Record Host SDK（持久事实宿主开发工具包）。第一版的 `niceeval migrate` 对 v1 返回 `already-current`，对未知格式返回 `unsupported-format`。未来发布 v2 时必须同时提供 `v1 → v2`；从那时起 Maintenance 才按相邻版本逐条原地运行。普通 `show`、`view` 和 `exp` 永远不会静默改盘。

Git 负责恢复历史字节。NiceEval 不维护 staging Record、backup、rollback、root replacement 或恢复日志。迁移失败后 Record 拒绝正常读取，直到用户通过 Git 完整恢复 `.niceeval/record` 并重新迁移。

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
