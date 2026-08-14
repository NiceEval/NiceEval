# ③ Report（报告层）

Report（报告层）把 Analysis（分析层）已经闭合的结果组成可阅读、可比较、可下钻的报告，并呈现到 terminal（终端）、Web（网页）或 static site（静态站）。它不解释事实，也不决定统计口径；它决定读者先看什么、怎样比较、沿哪条路径复核，以及使用哪一种呈现面。

## 核心心智

Report 的输入只有 Analysis `query()`（查询）返回的 `SemanticFrame`（语义数据帧）与 `DomainView`（领域视图）。前者承载分组后的度量结果，后者承载追踪、时序与证据等领域结构。二者都已经闭合，Report 不接触 Record 或 raw facts（原始事实）。

```text
Analysis query()
        │
        ├── SemanticFrame ──→ neutral Components
        │                     Summary / Table / Bars / Line / Scatter / Heatmap
        │
        └── DomainView ────→ domain Components
                              TraceViewer / AttemptTimeline / EvidenceDrilldown
                                      │
                                      ▼
                           Page / PageFamily / Report
                                      │
                                      ▼
                         ClosedReportTree（闭合报告树）
```

Component（组件）、Page（页面）与 renderer（渲染器）同属 Report。组件定义一块结果怎样呈现，页面把若干组件排列成一个阅读任务，Report 把固定页面和 PageFamily（页面族）收成一个可执行的报告定义。三个 renderer 消费同一棵 `ClosedReportTree`，不会形成第四层。

## 组件子结构

### 中立组件

中立组件只理解维度、度量、`MetricValue`（度量值）和显示交互。它们的输入是 `SemanticFrame`，不会认识 Run、Attempt、Trace 或 evaluator。

```text
SemanticFrame
   ├── Summary       少量度量的摘要
   ├── Table         精确值、分母与问题面
   ├── Bars          分类值比较
   ├── Line          有序维度上的序列
   ├── Scatter       两个度量的关系
   └── Heatmap       两个分类维度的交叉比较
```

组件依照 typed field identity（类型化字段身份）取值。`MetricValue` 的 `state`、`observed`、`denominator`、`issues` 和 `refs` 随输入保留；排序、行数限制和颜色只影响显示，不形成新总体，也不重算度量值。

### 领域组件

领域组件保留无法压进通用表格的结构。它们只接收 Analysis 已形成的 `DomainView`，不读取事实快照，也不取得领域 projection capability（领域投影能力）。

```text
DomainView
   ├── TraceViewer          TraceView
   ├── AttemptTimeline      AttemptTimelineView
   └── EvidenceDrilldown    EvidenceView
```

`TraceViewer` 展示一条追踪树，`AttemptTimeline` 展示一次 Attempt 的时序与完成状态，`EvidenceDrilldown` 展示有界证据内容或明确的问题。任何详情链接都使用 Analysis 给出的稳定身份；显示 label、数组位置和模糊时间匹配不能充当页面地址。

### 自定义复合组件

Report 作者可以用 `defineComponent()` 组合内建组件，并在 callback 中调用 `query()` 得到新的闭合输入。复合组件不注册 visual primitive（视觉原语），也不为某一种 renderer（渲染器）另写数据语义。

新的内建组件属于 `niceeval/report`。它必须同时定义 terminal、Web、static 与无 JavaScript 的可访问显示形态。NiceEval 不建立 `niceeval/components` 入口。

## 页面组合

一个 Page 只承担一个阅读任务，例如概览、比较或某一次 Attempt 的详情。Page 可以调用多个 Analysis query，并把返回的 frame 与 view 交给组件；它不能用返回行重新求值、删减分母或打开另一份事实快照。

PageFamily 从 Analysis 发布的稳定身份展开同类页面，例如每个 Attempt 或每条 Evidence 一页。family 的 key 与 route 都来自闭合结果中的身份字段，因此静态站、网页和终端下钻指向同一对象。

```text
Official Experiment Report
   ├── Overview Page
   │    ├── Summary
   │    ├── Bars
   │    └── Table
   ├── Comparison Page
   │    ├── Table
   │    └── Scatter
   ├── Attempt PageFamily
   │    ├── AttemptTimeline
   │    └── TraceViewer
   └── Evidence PageFamily
        └── EvidenceDrilldown
```

一个 Page 或 component instance 在一次 Report execution（报告执行）中最多运行一次。只请求一个 Page 时，其他 Page 不执行；某个 Page 的 callback、query 或组件失败时，它形成具名的 Page failure（页面失败），其他 Page 仍可闭合。

## 闭合与边界

Report execution 完成后，页面树只含可序列化的组件节点、闭合 frame、闭合 view、route 与问题。`AnalysisQuerySource`、Record reader、QueryPlan、callback、Promise 和 Analysis executor 都不进入树。

Report 包含：

- 中立组件、领域组件和复合组件；
- Page、PageFamily、route 与官方 Experiment Report；
- Page failure 隔离与 `ClosedReportTree`；
- terminal、Web 与 static renderer，以及 Web revision（网页修订版）的 last-good（最近成功）语义。

Report 不包含：

- Record reader、原始事实、SQL 或 migration authority（迁移权限）；
- Population（总体）、denominator（分母）、missing（缺失）、reduction（归并）或 Relation（关系）定义；
- 第二个查询接口、第三方 renderer plugin 或持久化的报告结果。

## 三个呈现面

| 呈现面 | CLI 命令 | SDK API | 用户得到什么 |
|---|---|---|---|
| terminal | `niceeval show` | `report.show(execution)` | 一次终端文本或同一 execution 的机器可读输出 |
| Web | `niceeval view` | `report.serve(execution)` | 本机 loopback 页面与闭合 route navigation |
| static | `niceeval view --out <directory>` | `report.export(execution, directory)` | 无需 NiceEval 进程的自包含目录 |

`show`、`serve` 与 `export` 只消费 `ReportExecution`。它们不重新取得 Record snapshot，不执行新的 Analysis query，也不改变 denominator（分母）、问题或 Evidence refs（证据引用）。

Web 的每个成功 revision 持有一棵新的闭合树。浏览器导航只读当前树；下一次重建失败时保留最近成功 revision，并显示失败问题。

## 入口

- [Library](library.md) —— Report 的公开 API、闭合树与失败合同。
- [官方 Experiment Report](use-case/README.md) —— Overview、Comparison、Attempt 与 Evidence 的完整组合。
- [三层总纲](../README.md) —— Record、Analysis 与 Report 的依赖方向。
