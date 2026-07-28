# `sources.measure.rows`

`sources.measure.rows(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：一行一个维度值，
一列一个读数。列按声明顺序排列。共用 Content 形状与两面规则见 [Measure 数据源](measure.md)。

```tsx
<Table
  source={sources.measure.rows({
    dimensions: ["agent"],
    measures: [passRate, costUSD, durationMs],
    sort: passRate,
    evals: "coding/",
  })}
  filter
/>
```

```ts
interface MeasureRowsOptions {
  /** 空数组表示整个 Sample 只产生一行聚合结果。 */
  dimensions: readonly DimensionInput[];
  measures: readonly [Measure, ...Measure[]];
  sort?: Measure;
  evals?: string | readonly string[];
}

function rows(
  options: MeasureRowsOptions,
): Source<Sample, Dataset>;
```

- `measures` 至少一个，Measure name 在同一张表内唯一。
- `sort` 必须引用 `measures` 中已声明 `better` 的 Measure，否则计算以完整用户反馈失败。
- `evals` 在聚合前收窄题集，因此属于 Source options，不属于 Table props。
- `filter` 只给 web 面增加行过滤框；排序与过滤是浏览状态，不改变数据与 text 面。
- 手工计算写 `await sources.measure.rows(options).compute(input)`，所得 `Dataset` 可直接交给
  `<Table data={content}>`。

## 相关阅读

- [Measure 数据源](measure.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`sources.measure.matrix`](measure-matrix.md) / [`sources.measure.scoreboard`](measure-scoreboard.md) /
  [`sources.measure.delta`](measure-delta.md) /
  [`sources.measure.stability`](measure-stability.md) —— 其它表格数据源。
