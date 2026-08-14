# Record（持久事实层）→ Analysis（分析层）→ Report（报告层）

NiceEval 把不可恢复的运行事实、统计解释和结果呈现分成三层。普通用户通过 CLI（命令行界面）运行、查看、比较和迁移，不直接进入 `.niceeval`，也不接触 Record schema（持久事实格式）或执行 backend（执行后端）。

```text
┌──────────────────────────────────────────────────────────────┐
│ ③ Report（报告层）                                          │
│ Page / Report / Table / Bars / TraceViewer                  │
│ terminal / Web / static renderer                            │
│ （页面 / 报告 / 组件 / 终端 / 网页 / 静态渲染器）           │
└──────────────────────────────▲───────────────────────────────┘
                               │ SemanticFrame / DomainView
                               │ （语义数据帧 / 领域视图）
┌──────────────────────────────┴───────────────────────────────┐
│ ② Analysis（分析层）                                        │
│ Population / Dimension / Measure / Relation                 │
│ Query / internal executor                                   │
│ （总体 / 维度 / 度量 / 关系 / 查询 / 内部执行器）           │
└──────────────────────────────▲───────────────────────────────┘
                               │ CurrentRecordSnapshot
                               │ （当前事实快照）
┌──────────────────────────────┴───────────────────────────────┐
│ ① Record（持久事实层）                                      │
│ Assertion / OTel / third-party data / file diff             │
│ write / seal / validate / migrate / lock                    │
│ （断言 / 遥测 / 第三方数据 / 文件差异 / 写入 / 封口 / 迁移）│
└──────────────────────────────────────────────────────────────┘
```

## 三层分别回答什么

| 层 | 心智模型 | 只回答的问题 | 详细入口 |
|---|---|---|---|
| ① Record（持久事实层） | 已发生事实的唯一账本 | 运行中发生了什么，旧格式怎样显式迁移为当前格式 | [Record](record/README.md) |
| ② Analysis（分析层） | 统计口径合同 | 事实怎样进入总体、分母、归并、比较和闭合结果 | [Analysis](analysis/README.md) |
| ③ Report（报告层） | 可执行的阅读产品 | 查询结果怎样组成组件与页面，并呈现到终端、网页和静态站 | [Report](report/README.md) |

## 核心术语与最小例子

| 术语 | 在本架构中的意思 | 最小例子 |
|---|---|---|
| `CurrentRecordSnapshot`（当前事实快照） | ① Record Host SDK 冻结的一组已封口 Run；不含草稿、锁或磁盘路径 | Run A 与 Run B 的完整 Attempt、Assertion、OTel 和文件差异 |
| `Population`（总体） | ② Analysis 要解释的完整成员集合 | 一次实验预期运行的 10 个 logical slot（逻辑槽位） |
| `Dimension`（维度） | 用来分组或标识总体成员的字段 | `model = "gpt-5"`、`condition = "memory-on"` |
| `Measure`（度量） | 一次声明归并、分母、缺失和证据规则的统计口径 | 通过率以 10 个预期 slot 为分母，而不是只数 8 个有结果的 slot |
| `SemanticFrame`（语义数据帧） | 适合 Table、Bars、Scatter 等中立组件的闭合表格结果 | 每行是一组维度坐标，每个度量单元同时保存值、状态、实际贡献数、分母、问题和证据引用 |
| `DomainView`（领域视图） | 不能压成规则表格的闭合领域结构 | 某个 Attempt 的 span 树、事件时序或 Evidence 详情 |
| `ClosedReportTree`（闭合报告树） | ③ Report 完成查询和页面回调后的自包含页面树 | Overview、Comparison 与 Attempt 详情页；终端、Web 和静态站都消费同一棵树 |

`SemanticFrame` 不是 Record 物理表，也不是只装数字的普通 DataFrame（数据帧）。例如按模型比较通过率时，一行可以是：

它也不是 `defineSemanticFrame()` 产生的定义。Analysis 作者先用 `definePopulation()`、`defineDimension()` 和 `defineMeasure()` 声明统计语义；随后 `query(source, request)` 从同一冻结快照中选中的一个或多个 Run 计算出 `SemanticFrame`。结果可以随时重算，不写回 Record。

```text
多个 sealed Run（已封口运行）
        │ record.snapshot() + analysis.openSource(selection)
        ▼
AnalysisQuerySource（分析查询句柄）
        │ query(source, { by, measures })
        ▼
SemanticFrame（语义数据帧）
```

```ts
{
  dimensions: { model: "gpt-5" },
  measures: {
    passRate: {
      value: 0.8,
      state: "partial",
      observed: 8,
      denominator: 10,
      issues: [{ code: "missing", members: 2 }],
      refs: [/* exact Evidence refs（精确证据引用） */],
    },
  },
}
```

这行表示“预期 10 个 slot，8 个实际贡献，通过率按既定口径得到 0.8，另有 2 个缺失”。`Table` 与 `Bars` 直接读取完整单元，不得只拿 `0.8` 再猜分母。

`DomainView` 保留树或时序。例如 `TraceView`（追踪视图）包含父子 span、开始结束时间、问题和 Evidence refs；把它写入 `SemanticFrame` 会丢失层级，所以交给 `TraceViewer`（追踪查看器）而不是中立图表。

Query（查询）、`SemanticFrame`（语义数据帧）和 `DomainView`（领域视图）由 Analysis 拥有。Components（组件）、Page（页面）、terminal/Web/static renderer（终端 / 网页 / 静态渲染器）由 Report 拥有。NiceEval 不建立 `niceeval/fact`、`niceeval/query`、`niceeval/view`、`niceeval/components` 或 `niceeval/delivery` 公共入口。

## 作者与 Application Host API（应用宿主接口）

```text
作者定义面                                      宿主用例面

"niceeval"                                     "niceeval/application/host"
defineEval() / t.check()                         experiments.*
Assertion-first（断言优先）                      reports.* / maintenance.*
        │                                               │
"niceeval/analysis"                                    │
definePopulation / defineMeasure / query                 │
        │                                               │
"niceeval/report"                                      │
definePage / defineReport / Table / Bars                 │
        └────────────────── definitions（定义） ────────┘
                                │
                                ▼
                   Record → Analysis → Report
```

`niceeval/application/host` 是 host-only API（仅宿主应用程序接口）。第一方 CLI 与嵌入宿主用它调用完整用例；普通 Eval、Analysis 或 Report 作者不使用它。

Application Host 不构成第四层。它只把一次宿主操作编排到三层的 `Layer Host SDK`（层宿主开发工具包），并在最外层建立 Effect v3 Scope（Effect v3 资源作用域）。文件、锁和进程细节都封装在 SDK 内部，不进入架构调用面。

```ts
interface ApplicationHost {
  readonly experiments: ExperimentOperations;
  readonly reports: ReportOperations;
  readonly maintenance: MaintenanceOperations;
}
```

| 层 | Host SDK 入口 | 提供给 Application Host 的 API |
|---|---|---|
| ① Record | `niceeval/record/host` | `snapshot()`、`write()`、`maintenance()`；内部拥有锁与迁移资源 |
| ② Analysis | `niceeval/analysis/host` | `openSource()`；`query()` 仍由 `niceeval/analysis` 拥有 |
| ③ Report | `niceeval/report/host` | `execute()`、`show()`、`serve()`、`export()` |

## 每条命令从哪里读、向哪里写

下面省略 CLI handler 与宿主编排胶水，只画真正拥有数据的层及其 exact API（精确接口）。`read` 表示读取，`write` 表示持久写入。

### `niceeval exp list`

```text
read  ──▶ ExperimentDefinitionRegistry.list()
write ──▶ 无

不调用 ① Record、② Analysis 或 ③ Report。
```

### `niceeval exp --dry`

```text
read  ──▶ ① Record Host SDK：record.snapshot()
              └─▶ ExperimentPlanner.plan(snapshot, request)
write ──▶ 无

锁：shared maintenance lock（共享维护锁），计划形成后释放。
```

### `niceeval exp`

```text
read  ──▶ ① Record Host SDK：record.write().view
write ──▶ ① Record Host SDK：write.capture()
                         write.sealRun()

锁：同一个 shared maintenance + writer Scope（共享维护锁 + 写入锁作用域）。
```

### `niceeval accept @<locator>...`

```text
read  ──▶ ① Record Host SDK：record.write().view
              └─▶ exact locator eligibility（精确定位符资格检查）
write ──▶ ① Record Host SDK：write.sealRun()
              └─▶ reference-only Run（仅引用运行）

锁：检查和发布共用一个 write Scope，不在中间释放。
```

### `niceeval show`

```text
read  ──▶ ① Record Host SDK：record.snapshot()
          ② Analysis Host SDK：analysis.openSource()
             Analysis SDK：query()
          ③ Report Host SDK：report.execute() / report.show()
write ──▶ 无

结果：ReportShowOutput（报告显示输出）。
```

### `niceeval view`

```text
read  ──▶ ① Record Host SDK：record.snapshot()
          ② Analysis Host SDK：analysis.openSource()
             Analysis SDK：query()
          ③ Report Host SDK：report.execute() / report.serve()
write ──▶ 无

每次 rebuild（重建）闭合一棵报告树后释放 Record 读锁；浏览器导航只读闭合树。
```

### `niceeval view --out <directory>`

```text
read  ──▶ ① Record Host SDK：record.snapshot()
          ② Analysis Host SDK：analysis.openSource()
             Analysis SDK：query()
          ③ Report Host SDK：report.execute() / report.export()
write ──▶ ③ Report Host SDK：只写目标静态目录，不写 Record

Record 读锁在报告树闭合后释放，随后才写目标目录。
```

### `niceeval migrate`

```text
read  ──▶ ① Record Host SDK：record.maintenance().inspect()
                         maintenance.planMigrate()
            └─▶ 释放独占维护锁并请求用户授权
write ──▶ ① Record Host SDK：record.maintenance()
                         maintenance.applyMigrate()

应用前重新检查 root、源格式和迁移集合，计划身份变化时不写盘。
```

运行、采用和迁移只调用 ① Record，因为这些命令产生或维护事实。查看与导出才依次读取 ①②③。判断分层是否成立，要看每次读写是否进入语义 owner（所有者）的窄 API，而不是强迫每条命令经过所有层。

## 数据怎样穿过三层

```text
Assertion-first API / OTel bridge / Adapter / diff collector
                          │
                          ▼
record.capture() → seal → CurrentRecordSnapshot
                                      │
                                      ▼
                        niceeval/analysis.query()
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
             SemanticFrame（语义数据帧）   DomainView（领域视图）
                       └──────────────┬──────────────┘
                                      ▼
                     Page / Components / ClosedReportTree
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                      terminal        Web        static site
```

Record 只保存无法从已有事实重新计算的内容。通过率、均值、排名、denominator（分母）、missing（缺失）汇总、图表点位与页面树都由上层按定义重新形成。

## Record 数据边界

| 数据 | 进入 Record 的方式 | 持久边界 |
|---|---|---|
| AssertionResult / Evidence | Assertion producer 自动封口 | 固定 Assertions envelope（断言信封）与有界 Evidence refs（证据引用） |
| OTel | Adapter 或平台 bridge 提交给 owner-bound collector（所有者绑定采集器） | 平台拥有的具名 Attachment family（附件族） |
| 第三方观测 | 所属 SDK 授予的受限 Capture capability | 固定 Metric / Score / Artifact envelope；第三方不注册 converter |
| 文件差异 | Sandbox diff collector（沙箱差异采集器） | 路径、change kind、hash、大小与 partial/elided 状态内联；大型、二进制或多文件内容进入 Artifact/blob closure |

`RecordAttachmentSchemaId` 一经发布便冻结 payload shape（载荷形状）、owner（所有者）与语义。改变值类型、scope（作用域）、cardinality（基数）、单位或坐标域必须使用新 identity（身份）。显示名、格式、颜色、统计口径和组件配置不属于持久 schema。

## Migration（迁移）边界

平台只维护一个当前 Record schema。Analysis 不接收历史版本联合，也不在每次读取时执行历史兼容。

```text
Old Record（旧事实集）
        │ niceeval migrate
        ▼
Current Record（当前事实集）
        │
        ▼
Analysis（分析层）
```

旧版本识别、相邻 converter、staging validation（暂存区校验）、恢复点与原子发布属于 Record Host SDK（持久事实宿主开发工具包）。SDK 内部负责文件和锁。普通 `show`、`view` 和 `exp` 遇到旧版本时返回 `migration-required`，不会静默改盘。

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

DuckDB 只能位于内部 `QueryPlan` 之后。它不能定义 population、denominator、missing、retry 或 Evidence 口径，也不能把 Record 物理表暴露给 Report 作者。

## 全局不变量

1. Record 只持久化不可恢复的事实，不保存 Analysis 或 Report 派生结果。
2. 普通作者没有通用 Fact API、Record writer、migration converter 或 `.niceeval` 文件接口。
3. Analysis 只接收当前 schema 的冻结快照。
4. Analysis 独占 population、denominator、missing、reduction 与 relation 语义。
5. Report 只消费闭合 `SemanticFrame`、`DomainView` 与 opaque identity（不透明身份）。
6. terminal、Web 与 static renderer 都属于 Report，并消费同一棵 `ClosedReportTree`。
7. scalar（标量）丢失 state、denominator、issues 或 refs 后，不能重新包装成 Measure result（度量结果）。
8. 新查询、新组件和新输出媒介不会要求 Record migration。

## 文档入口

每层的 README 定义心智模型与边界；`library.md` 是 API、类型、状态与错误的唯一契约；`use-case/` 展示完整组合路径。

| 层 | 心智模型 | API 契约 | 完整路径 |
|---|---|---|---|
| Record | [README](record/README.md) | [Library](record/library.md) | [Use case](record/use-case/README.md) |
| Analysis | [README](analysis/README.md) | [Library](analysis/library.md) | [Use case](analysis/use-case/README.md) |
| Report | [README](report/README.md) | [Library](report/library.md) | [Use case](report/use-case/README.md) |
