# `mark: "line"`

折线用于数值参数趋势或确有顺序的维度，不用于给无关类别虚构连续关系。

```tsx
const trend = sources.measure.rows({
  dimensions: [budget, "agent"],
  measures: [passRate],
});

<Chart source={trend} x="budget" y="passRate" legend tooltip>
  <Series id="pass-rate" mark="line" by="agent" />
</Chart>
```

缺点默认断线。需要跨缺失点连线时在 `<Series id="pass-rate">` 上显式声明
`connectNulls`；它只改变线段，不制造 MeasureCell。

## 相关阅读

- [`Chart`](README.md) —— Dataset、字段映射、轴与两面契约。
