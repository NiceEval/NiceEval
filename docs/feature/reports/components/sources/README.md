# 数据源目录

数据源回答「这份数据怎么算、默认摆成什么样」。它是[原语](../README.md#原语总表)之外的另一半：
原语只认[单元格类型](../README.md#单元格类型)，领域知识全部住在这里。

一个数据源是一个具名值，公开面有三样：`compute()`、默认呈现声明和可序列化的 Content 形状。
无需配置的数据源直接导出值；需要选择维度或读数的数据源导出同名工厂。作者自己写一个数据源与使用
官方数据源没有形态差别。

## 范围级数据源

收 `ReportInput`（`Sample` 或 `Run[]`），聚合口径见[读数与维度](../../library/measures.md)。

| 数据源 | 一行/一格是什么 | 配的原语 | 形状 |
|---|---|---|---|
| `experimentRows` | 一个 experiment，下钻到 eval 与 attempt | `Table` | [实体行](../entity-lists/README.md#数据形状) |
| `evalRows` | 一道题，下钻到 attempt | `Table` | [实体行](../entity-lists/README.md#数据形状) |
| `attemptRows` | 一次 attempt | `Table` | [实体行](../entity-lists/README.md#数据形状) |
| `measureRows` | 一个维度值 × 你挑的读数列 | `Table` | [表格数据](../tables/README.md#共用数据形状) |
| `measureMatrix` | 两个维度的交叉格 | `Table` | [矩阵数据](../tables/README.md#共用数据形状) |
| `scoreboard(...)` | 固定题集上的一行成绩，含分科与权重 | `Table` | [成绩单](../tables/scoreboard.md) |
| `deltaRows(...)` | 同一道题在若干条件上的读数与差值 | `Table` | [成对差异](../tables/delta-table.md) |
| `stabilityRows(...)` | 一道题跨 Run 的稳定性 | `Table` | [稳定性](../tables/stability-matrix.md) |
| `chart(...)` | 由维度、读数与 series 声明算出的图表 Content | `Chart` | [图表](../charts/README.md) |
| `sampleSummary(...)` | 范围摘要的每一格读数 | `Grid` | [Sample 摘要](../summaries/sample-summary.md) |
| `sampleProvenance` | 最近 Run 时间与贡献 Run 数 | `HeroCard` | [Hero](../site/hero.md) |
| `sampleWarnings` | 一条选择警告 | `Callouts` | [Sample 警告](../site/sample-warnings.md) |
| `runDiagnostics` | 一条 Run 诊断 | `Callouts` | [Run 诊断](../site/run-diagnostics.md) |
| `traceRows` | 一次 attempt 的执行瀑布 | `Waterfall` | [`traceRows`](../site/trace-waterfall.md) |
| `fixPrompt` | 范围内全部失败组装成的一段修复 prompt | `CopyBlock` | [`fixPrompt`](../site/copy-fix-prompt.md) |

## attempt 级数据源

只收一份 [`AttemptEvidence`](../../../record/library.md)，不收 `Sample`。省略 `input` 时取当前
attempt-input page 注入的那一份；放在 sample-input page 且又没有显式 `input` 时，
resolve 以完整用户反馈报错并指引移到 attempt-input page 或传入 evidence。

| 数据源 | 投影什么 | 配的原语 |
|---|---|---|
| `attemptSummary` | 身份、判定、本轮挣分、耗时、成本与证据能力位 | `Grid` |
| `attemptUsage` | 轮数、工具调用数、token 拆分与成本 | `Grid` |
| `attemptError` | 结构化 error 与 cause | `Callouts` |
| `attemptDiagnostics` | lifecycle 分组的 attempt 级诊断 | `Callouts` |
| `attemptAssertions` | 断言条目与给分记录 | `Table` |
| `attemptSource` | 带标注的 eval 源码与逐行证据 | `SourceView` |
| `attemptConversation` | 分轮事件流与失败命令卡 | `Conversation` |
| `attemptTimeline` | runner phases 与按 `traceId` 关联的 spans | `Waterfall` |
| `attemptTrace` | 不混入 runner 节点的原始 OTel span 树 | `Waterfall` |
| `attemptDiff` | generated / modified / deleted 文件与 patch | `DiffView` |
| `attemptFixPrompt` | 这一次失败的修复 prompt | `CopyBlock` |

每个 attempt 级数据源在没有对应事实时返回 `null`，原语两面都渲染为空。数据源不自己读
artifact：[`loadAttemptEvidence`](../../../record/library.md) 已经完成一次性装配，
数据源只做适合展示与序列化的派生。

## 写一个数据源

```ts
interface DataSource<Content, Input = Sample> {
  name: string;
  compute(input: Input): Promise<Content>;
}

interface RowSource<RowValue extends Row, Input = ReportInput>
  extends DataSource<TableContent<RowValue>, Input> {
  /** 省略 <Column> 时用的默认列；收已解析的行，所以随数据切换列的判断住在这里。 */
  columns(rows: readonly RowValue[]): readonly ColumnSpec[];
}
```

三条纪律：

- **聚合只发生在 `compute` 里。** 原语与渲染回调都不能触发第二次聚合，
  这条边界保证两面计算同源。
- **折成 `Cell` 时保住证据。** 有官方读数的读数用 `measure` 格，别压成字符串——
  压了就丢掉 `samples` / `total` / `refs`。
- **默认列随数据变就写进 `columns()`。** 按题型选主列这类判断在数据源里做一次，
  原语与作者都不重复它。

## 相关阅读

- [组件树](../README.md) —— 三层模型与单元格类型。
- [`Table`](../primitives/table.md) —— 单元格渲染契约。
- [读数与维度](../../library/measures.md) —— `Measure`、`Dimension` 与聚合口径。
- [Record](../../../record/library.md) —— `Sample`、`AttemptEvidence` 与身份键去重。
