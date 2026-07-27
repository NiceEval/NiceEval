# `sources.entity.evals`

`sources.entity.evals` 是 `Table` 数据源。每个顶层 Row 表示 `experimentId + evalId`,子行是一轮 Attempt。
父行显示折叠判定、Attempt 数、聚合分数、平均耗时与平均成本,但不复述任一轮的失败内容。

```tsx
const content = await ctx.resolve(sources.entity.evals);
const rows = content.rows.filter((row) => row.cells.verdict.verdict !== "passed");
<Table data={{ ...content, rows }} />
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`sources.entity.experiments`](experiment-rows.md) / [`sources.entity.attempts`](attempt-rows.md) /
  [`FailureList`](failure-list.md)
  —— 其它实体数据源与组合组件。
