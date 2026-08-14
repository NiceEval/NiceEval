# ② Analysis（分析层）

Analysis（分析）是 Record v1 之上唯一解释事实的层。它固定选择、总体、分母、归并、缺失、
producer（生产者）可比性与 Evidence（证据）引用，再把闭合结果交给 Report（报告）。

Record 保存已经发生且已封口的事实。Report 只把闭合结果组成页面和呈现面。两层都不能重新
选择成员、缩小分母或重算指标。

```text
① Record v1
  RecordReadSession ──▶ RecordSelection
                              │
                              ▼
② Analysis
  Sample ──▶ Population / Dimension / Measure / Relation ──▶ query / aggregate
                              │                                  │
                              │                                  ▼
                              └──────────────────── SemanticFrame / ClosedRows / DomainView
                                                                     │
                                                                     ▼
③ Report
  Page / component / terminal / web / static renderer
```

## 心智模型

Analysis 作者声明什么才算同一个总体成员、如何分组、怎样把事实归并为读数，以及一个读数
缺少事实时如何保留分母和原因。宿主随后把一次冻结的 RecordSelection（事实选择）打开成
Sample（样本），按每个请求需要惰性读取 v1 事实。

一次 Selection 固定 Run、logical Slot、预期成员与 Core 问题。它不是执行规划：reuse planning
决定下一次执行什么；Analysis 只解释已经封口的 Run。`not-recorded` 也只是历史事实，不能被
解释成待执行工作。

OTel、事件、Evidence、文件差异与 blob 都保持在 Record 中。打开 Sample、查看样本命中范围
或编解码 Snapshot 不读取它们。只有某个 Measure 的 AnalysisInput（分析输入）或 DomainView
请求它们时，Analysis 才在当前 Scope（资源作用域）内读取所需闭包。

## 谁能定义什么

| 对象 | owner | 作者能做什么 |
|---|---|---|
| `Population`、`Dimension`、`Measure`、`Relation` | Analysis | 用公开的 `define*()` 声明统计语义 |
| `AnalysisInput`、`PopulationMembers`、`DomainViewRequest` | NiceEval 的 v1 Analysis catalog | 选择或传入已发布定义，不能构造或注册 |
| `RecordSelection`、`Sample` | Record / Analysis Host | 宿主选择并签发；作者不能从路径、root 或回调构造 |
| `SampleSnapshot`、coverage、locator | Analysis | 读取、编解码和审计冻结选择；不能借此恢复读取能力 |
| `MetricValue`、`ClosedRows`、`SemanticFrame`、`DomainView` | Analysis operation | 只由 `query()` 或 `aggregate()` 返回，不能手工伪造 |

Calculation（计算）是 Measure 所表达的统计口径，不是另一种公开 descriptor。没有
`Calculation`、`defineCalculation()`、plan 或 facade。普通 Report 只把已经定义好的 Measure
传给 `aggregate()`；需要完整帧或诊断视图时使用 `query()`。

## 两种操作，单一口径

`aggregate(sample, { by, values })` 是 Report 的简洁路径。它推断共同 Population，返回可直接交给
`Table`、`Bars` 或 `Stat` 的 `ClosedRows`。`query(sample, request)` 是 Analysis 的完整路径：表格请求
返回 `SemanticFrame`，领域请求返回 `DomainView`。

两种操作使用同一份 Measure、分母、缺失和 Evidence 规则。`aggregate()` 等价于同一表格查询的
`rows`，不是另一套聚合实现。Report 可以排序、限制或过滤已闭合行的显示，却不能把所得数组再次
聚合，或以它改变 `MetricValue.total`。

## Sample、选择与 Scope

`Sample` 同时代表两件事：可审计的冻结选择，以及只在其 Scope 内可用的惰性读取能力。
`SampleSnapshot` 是前者的纯值；它能安全地保留、编解码和收窄审计信息。它不是 Sample，不能
打开 Record 或执行查询。

Analysis Host 以 `RecordReadSession` 与 `RecordSelection` 建立 Sample。每个 Sample 只分析当前
选择中的 sealed Run；新封口的 Run 不会进入它。`explicit-runs` 保留具名 Run 的完整 expected Slot
框架；`project-current` 只保留仍与当前目标身份匹配的 Slot。CLI 的 `--run` 与精确 locator 只决定
选择哪个历史事实，不把 Record root 交给应用代码。

`narrowSample()` 用 RunId 或 SlotId 做单调交集。未匹配成员变成 `excluded`，但仍留在 Snapshot
状态统计中，因而“范围外”“没有 Member”与“Core 损坏”不会混成同一个空值。它不能重新纳入一个已
排除成员，也不能读取修改后的 Record。

Scope 关闭后，`query()`、`aggregate()` 与 `narrowSample()` 必须以 `analysis-sample-closed` 失败，
并且不得再发起 I/O。Snapshot 与已经得到的 SemanticFrame、ClosedRows 和 DomainView 不依赖该
能力，关闭后仍可呈现或序列化。

## 闭合输出

每个 Measure 单元都是 `MetricValue`，而不是未包装的 number。它同时携带 value、state、samples、total、
basis、issues 与 refs。合法零值仍是 value；没有值、输入不支持与读取失败必须保持不同 state。

`ClosedRows` 是带稳定 identity 和 frame-level issues 的只读行数组。它以及 `SemanticFrame` 和
`DomainView` 只含值、稳定身份、问题与证据引用；不含 reader、Scope、Promise、callback、文件路径
或未解释的 Record payload。Report 只消费这些闭合值。

## 入口

- [Library](library.md) —— Analysis 定义、Sample、query、aggregate 与闭合输出的精确契约。
- [Use cases](use-case/README.md) —— 比较多个运行，以及选择和收窄一个分析范围。
