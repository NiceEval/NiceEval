# Report 读数与显示语义

Report 选择要显示的维度和度量，但不定义总体、分母、缺失或归并算法。这些口径由 Analysis 的 Population、Dimension、Measure 和 Relation 唯一拥有。

## 从 Sample 得到 rows

```tsx
import { aggregate, Bars, Table } from "niceeval/report";
import { condition, costUSD, model, passRate } from "niceeval/analysis";

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

aggregate() 固定在本次 Sample 上运行。它返回每个分组坐标的闭合 rows，并让每个度量字段保持完整的 MetricValue。相同 Sample 和相同 Analysis 字段在同一份 ReportExecution 中共用结果，不因同一张表和图形同时显示而重算。

高级查询也只能交出闭合 rows 或闭合领域视图。Report 不能从查询结果拿到另一种事实读取能力，不能按显示结果重新选择成员。

## 分母和状态

MetricValue 的 exact 形状由 [Library](library.md#metricvalue) 定义。Report 只读取它，不改写其中的统计事实。

| 要显示的事实 | 使用字段 | 不允许的替代 |
|---|---|---|
| 当前数值 | value | 把 null 猜为零。 |
| 实际贡献数 | samples | 用可见 row 数代替。 |
| 既定分母 | total | 用筛选后 row 数缩小。 |
| 缺口或失败 | state 和 issues | 靠空字符串、颜色或隐藏行表达。 |
| 可复核路径 | refs | 用显示 label 或数组下标伪造链接。 |

例如某个通过率读数有 20 个贡献成员、100 个预期成员：

```text
value:   0.80
samples: 20
total:   100
state:   partial
```

页面可以显示 80% · 20 / 100 · partial。它不能因为只画出 20 条有值数据，就把读数改成完整的 20 / 20。

available 与 partial 都可以有 value: 0。empty 是输入完整但领域结果为空；unsupported 是 host 缺少输入；failed 是读取或归并失败。它们都必须保留 issues 和 refs。

## 显示层可做什么

显示层可以对已经闭合的 rows 做排序、截断和筛选：

```ts
const topTen = rows
  .filter(row => row.passRate.value !== null)
  .toSorted((left, right) =>
    (right.passRate.value ?? -Infinity) - (left.passRate.value ?? -Infinity),
  )
  .slice(0, 10);
```

这段处理只影响可见项目。topTen 内每一个 MetricValue 仍带原来的 total、state、issues 和 refs。它不能被当成新总体，也不能再次交给 aggregate() 作为成员输入。

若用户需求需要排除一类 Eval 后重新计算，或要改变 paired 比较的对应规则，应修改 Analysis selection、Population、Relation 或 Measure，而不是在 Report 回调里过滤数组后重新归并。

## 中立组件

Table、Bars、Line、Scatter 与 Stat 只理解显示形状：

- Table 保留整组 ClosedRows 的 identity 与 issues，并在单元格显示 MetricValue 的完整度和 Evidence navigation。
- Bars、Line 和 Scatter 用字段名或闭合 accessor 选择坐标。它们不接收未执行的字段定义，也不根据色彩重写数值语义。
- Stat 接收完整 MetricValue，不接收从 value 拆出的 number。
- 外部业务数组可以进入这些组件，但不会自动获得分母、问题或 Evidence 语义。

图形必须能降级为同一批 rows 的文字或表格。每一项至少保留显示 label、数值、samples、total、state 和可用的复核链接。

## 领域视图

Trace、Attempt、会话、源码和文件差异不适合压成普通 rows 时，Report 通过 query() 或 PageLoadContext 取得对应的闭合领域视图。领域组件可以理解该视图的稳定 identity 和 issues，但仍不能打开路径、拉取附件或让浏览器再次读数据。

## 相关阅读

- [Analysis Library](../analysis/library.md)：总体、度量、分母和闭合输出的 owner。
- [Report Library](library.md)：组件和页面的公开形状。
- [比较质量与成本](use-case/比较质量与成本.md)：同一 rows 同时进入表格和散点图。
- [核对数据完整度](use-case/核对数据完整度.md)：partial、empty、unsupported 与 failed 的呈现。
