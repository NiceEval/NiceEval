# `measureRows`

`measureRows(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：一行一个维度值，
一列一个读数。列按声明顺序排列。共用 Content 形状与两面规则见[表格与矩阵](README.md)。

```tsx
<Table
  source={measureRows({
    rows: "agent",
    measures: [endToEndPassRate, examScore, costUSD, durationMs],
    sort: endToEndPassRate,
  })}
  evals="coding/"
  filter
/>
```

```ts
interface MeasureRowsOptions {
  rows: DimensionInput;
  measures: readonly [Measure, ...Measure[]];
  sort?: Measure;
}

function measureRows(
  options: MeasureRowsOptions,
): RowSource<TableRow>;
```

- `measures` 至少一个，Measure name 在同一张表内唯一。
- `sort` 必须引用 `measures` 中已声明 `better` 的 Measure，否则计算以完整用户反馈失败。
- `evals` 是 `Table` source 形态的共用选项，不重复进入 `MeasureRowsOptions`。
- `filter` 只给 web 面增加行过滤框；排序与过滤是浏览状态，不改变数据与 text 面。
- 手工计算写 `await measureRows(options).compute(input)`，所得 `TableContent` 可直接交给
  `<Table data={content}>`。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`measureMatrix`](measure-matrix.md) / [`scoreboard`](scoreboard.md) / [`deltaRows`](delta-table.md) /
  [`stabilityRows`](stability-matrix.md) —— 其它表格数据源。
