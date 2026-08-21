# Report 读数与显示语义

Report 选择显示维度和度量，却不定义总体、分母、缺失或归并算法。这些语义只由 Analysis 的 Population、Dimension、Measure 与
Relation 拥有。`aggregate()` 在 Page 或组合组件执行期间取得闭合结果；text、web 与静态文件随后只使用同一批值。

## `aggregate()` 是唯一 Analysis facade

```tsx
import {
  aggregate,
  Bars,
  defineComponent,
  Grid,
  model,
  passRate,
  Table,
  type GroupFunction,
} from "niceeval/report";

const condition: GroupFunction = subject =>
  String(subject.run.experiment?.flags.condition ?? "unknown");

const Overview = defineComponent(async (_props: {}, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { model, condition },
    values: {
      passRate,
    },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" color="condition" />
      <Table rows={rows} />
    </Grid>
  );
});
```

`ctx.scope` 是组合组件取得 Sample 的唯一字段。`aggregate()` 返回带稳定 row identity、issues 与 refs 的 `ClosedRows`；Table、图形和
text 面读取同一组 rows，不会分别归并同一份事实。

成本 Measure 是显式的 Report 整合：只有 `ctx.report.pricing` 非 `null` 的组件才能请求它。其 Profile 参数、Analysis 投影、
无 Profile 呈现与 Runner estimate 的隔离由 [Report 成本投影](cost-projections/README.md) 单点定义。

## 作者形态与未发布形态

| 作者需要 | Report 形态 | 边界 |
|---|---|---|
| 按固定 Sample 分组 | `aggregate(scope, { by, values })` | 委托唯一的 Analysis executor。 |
| 固定维度 | `agent`、`model`、`attempt`、`evalId`、`experiment`、`reasoningEffort`、`flag()`、`label()` | 只读取冻结 Run context。 |
| 自定义分组 | `GroupFunction` | 只读 `experimentId`、`evalId` 与冻结的 agent / model / flags / labels。 |
| 固定度量 | `passRate`、`durationMs`、`tokens` 与[成本 Measure](cost-projections/library.md) | 由 Analysis 定义分母、缺失、成本 ledger 与 Evidence。 |
| 领域读取 | `toAttemptEvidence()`、`toAttemptObservability()`、`toFileChanges()`、`toSources()`、`toSandboxHistory()` | 返回关闭 DomainView。 |

`rollup()`、`metricValue()`、`totalScore`、AttemptHandle converter 与任意 Reducer 没有 `niceeval/report` export。它们不能由同名
但较窄的 facade 冒充：两级归并、手写 MetricValue 或可读 Attempt 都会改变分母和 Evidence 语义。

`GroupFunction` 的返回值必须是稳定 string。它不能取得 reader、Path、Scope 外数据或当前配置。零 Attempt 的 logical Slot 仍由
Analysis 留在其既定分母中。

## MetricValue 与分母

`MetricValue` 的完整形状由 [Library](library.md#aggregate-与-metricvalue) 定义。每个度量单元都保留完整状态，而非只保留 number。

| 要显示的事实 | 使用字段 | 不允许的替代 |
|---|---|---|
| 当前数值 | `value` | 把 `null` 当作零。 |
| 实际贡献数 | `samples` | 用可见 row 数代替。 |
| 既定分母 | `total` | 用筛选后的 row 数缩小。 |
| 缺口或失败 | `state` 与 `issues` | 靠空字符串、颜色或隐藏行表达。 |
| 可复核路径 | `refs` | 用显示 label 或数组下标伪造链接。 |

例如某个通过率有 20 个贡献成员和 100 个预期成员：

```text
value:   0.80
samples: 20
total:   100
state:   partial
```

页面可以在摘要旁显示 `80% · 20 / 100 · partial`。它不能因为只画出 20 行有值数据，就把读数写成 `20 / 20`。

终端 Table 对完整读数只显示业务值。`state: available` 且 `samples === total` 时，`80%` 已足以表达这格的正常结果，
不在每格重复 `100 / 100 · available`。`partial`、`empty`、`migration-required`、`unsupported`、`unavailable` 与
`failed` 仍显示状态。终端 Table 的紧凑单元格写成 `80% · partial`；相邻 Result 摘要负责解释结果构成，详情与机器输出仍保留
`samples`、`total` 和 `basis`。这项压缩只改变 text 投影，不删除或重算底层 `MetricValue`。

自定义 Report 可以按上面的紧凑形态把完整度放在读数旁边。内建 Overview 把两者分开：指标单元格只显示业务值，缺少结果时另用一个
有标题的 `Result coverage` Section 显示可用结果数与预期结果数。这个 Section 只改变信息层级，不删除或重算底层 `MetricValue`。

| state | `value` | 必须保留的含义 |
|---|---|---|
| `available` | number | 全部预期成员按度量规则贡献。 |
| `partial` | number 或 null | 部分成员贡献，issues 说明缺口。 |
| `empty` | null | 输入完整，领域结果合法为空。 |
| `migration-required` | null | Record family 需要迁移后才能读取。 |
| `unsupported` | null | Host 缺少所需 Analysis 输入。 |
| `unavailable` | null | 输入存在，但该度量无法形成可报告值。 |
| `failed` | null | 读取或归并失败，issues 保留身份与 refs。 |

`available` 与 `partial` 都可以有 `value: 0`。排序、截断与筛选只能组织显示；每个保留的 `MetricValue` 仍保持原来的
`total`、`state`、`issues` 与 `refs`。

## 中立组件与领域视图

Table、Bars、Line、Scatter 与 Stat 只理解显示输入。Table 保留 `ClosedRows` identity 和 issues；图形使用字段名选择坐标；
Stat 接收 `formatMetricValue()` 的显示字节。外部业务数组可以进入这些组件，但不会自动取得分母、问题或 Evidence 语义。

每个图形必须有同一批 rows 的 text 或表格等价内容。每项至少保留 label、value、samples、total、state 与可用 Evidence link；
颜色、hover、筛选和缩放只能增强这些内容。

Attempt、会话、Source、文件差异和时序适合使用关闭 DomainView。详情组件可以理解该视图的稳定 identity 与 issues，
却不能打开路径、读取 attachment 或让浏览器在导航时再次读取数据。

Source 与 Diff 如果进入全站路径，必须在构建时成为受限 page 内容或 asset。单目标 `show` 只读取所选 Page 所需的 DomainView；
它不会为其它详情页取得数据。

## 相关阅读

- [Analysis Library](../analysis/library.md)：总体、度量、分母和关闭输出的 owner。
- [Report Library](library.md)：`aggregate()`、组件、Page 与 `MetricValue` 形状。
- [Report 成本投影](cost-projections/README.md)：成本 Measure 的 Profile、Projection 与显示边界。
- [Architecture](architecture.md)：单目标 show、全站 SSG 与缓存。
- [比较质量与成本](use-case/比较质量与成本.md)：同一 rows 同时进入表格和散点图。
- [核对数据完整度](use-case/核对数据完整度.md)：partial、empty、unsupported 与 failed 的呈现。
