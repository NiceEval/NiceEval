# Report 读数与显示语义

Report 选择要显示的维度和度量，却不定义总体、分母、缺失或归并算法。这些口径由 Analysis 的 Population、Dimension、
Measure 与 Relation 唯一拥有。Report 在 `buildSiteRevision()` 期间消费已经关闭的结果。

## 从 Sample 得到 ClosedRows

```tsx
import {
  aggregate,
  Bars,
  condition,
  costUSD,
  defineComponent,
  Grid,
  model,
  passRate,
  Table,
} from "niceeval/report";

const Overview = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { model, condition },
    values: { passRate, costUSD },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" color="condition" />
      <Table rows={rows} />
    </Grid>
  );
});
```

`aggregate()` 固定在本次 Sample 上运行，返回带稳定行身份、issues 与 refs 的 ClosedRows。每个度量字段都是完整的
MetricValue。表格、图形和静态页面共享这批 rows；它们不各自归并同一份事实。

复杂读数由 `rollup()` 交出，领域内容由 `to*` 投影或 PageLoadContext 交出。作者可以用普通 TypeScript 组织这些
关闭值，却不能从显示结果重新选择成员或取得另一种事实读取能力。

## v0.12 作者调用

v0.12 的 `aggregate(sample, ...)`、`rollup(...)`、`metricValue(...)`、`evidenceRow(...)` 与 `to*` 投影继续以普通
TypeScript 值工作。新的 Sample 将这些调用连接到 Analysis，完整 MetricValue 保留既有字段并带状态与问题。

作者可以对 rows 调用 `filter()`、`toSorted()`、`slice()` 和普通 join。这些操作只组织显示。它们不能改变任何
MetricValue 的 `total`、`state`、`issues` 或 `refs`。

## 分母和状态

MetricValue 的准确形状由 [Library](library.md#metricvalue) 定义。Report 只读取它，不改写其中的统计事实。

| 要显示的事实 | 使用字段 | 不允许的替代 |
|---|---|---|
| 当前数值 | `value` | 把 `null` 猜为零。 |
| 实际贡献数 | `samples` | 用可见 row 数代替。 |
| 既定分母 | `total` | 用筛选后 row 数缩小。 |
| 缺口或失败 | `state` 与 `issues` | 靠空字符串、颜色或隐藏行表达。 |
| 可复核路径 | `refs` | 用显示 label 或数组下标伪造链接。 |

例如某个通过率有 20 个贡献成员和 100 个预期成员：

```text
value:   0.80
samples: 20
total:   100
state:   partial
```

页面可以显示 `80% · 20 / 100 · partial`。它不能因为只画出 20 条有值数据，就把读数改成完整的 `20 / 20`。

`available` 与 `partial` 都可以有 `value: 0`。`empty` 是输入完整但领域结果为空；`unsupported` 是 Host 缺少输入；
`failed` 是读取或归并失败。它们都保留 issues 和 refs。

## 显示层可做什么

显示层可以对已经关闭的 rows 排序、截断和筛选：

```ts
const topTen = rows
  .filter(row => row.passRate.value !== null)
  .toSorted((left, right) =>
    (right.passRate.value ?? -Infinity) - (left.passRate.value ?? -Infinity),
  )
  .slice(0, 10);
```

`topTen` 只改变可见项目。每一个 MetricValue 仍带原来的 `total`、`state`、`issues` 和 `refs`。它不能作为新的成员输入，
也不能再次传给 `aggregate()`。

若用户需要排除一类 Eval 后重新计算，或改变 paired 比较的对应规则，应修改 Analysis selection、Population、Relation 或
Measure，而不是在 Report 回调中筛选数组后重新归并。

## 中立组件

Table、Bars、Line、Scatter 与 Stat 只理解显示形状：

- Table 保留整组 ClosedRows 的 identity 与 issues，并在单元格显示 MetricValue 的完整度与 Evidence navigation。
- Bars、Line 和 Scatter 用字段名选择坐标，不接收未执行的字段定义，也不改写数值语义。
- Stat 接收完整 MetricValue，不接收从 `value` 拆出的 number。
- 外部业务数组可以进入这些组件，但不会自动获得分母、问题或 Evidence 语义。

图形必须能降级为同一批 rows 的文字或表格。每一项至少保留显示 label、数值、samples、total、state 与可用的复核链接。

## 领域视图与全站构建

Trace、Attempt、会话、Source 和文件差异不适合压成普通 rows 时，Report 通过 `to*` 投影或 PageLoadContext 取得关闭的
领域视图。详情 Page 在完整枚举时生成，静态文件也在同一次构建中写入 ClosedSiteRevision。

领域组件可以理解该视图的稳定 identity 和 issues，却不能打开路径、读取附件，或让浏览器在导航时再次读取数据。

## 相关阅读

- [Analysis Library](../analysis/library.md)：总体、度量、分母和关闭输出的 owner。
- [Report Library](library.md)：组件、Page 与全站构建边界。
- [比较质量与成本](use-case/比较质量与成本.md)：同一 rows 同时进入表格和散点图。
- [核对数据完整度](use-case/核对数据完整度.md)：partial、empty、unsupported 与 failed 的呈现。
