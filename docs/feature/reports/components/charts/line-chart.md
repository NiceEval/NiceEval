# `mark: "line"`

折线用于数值参数趋势或确有顺序的维度，不用于给无关类别虚构连续关系。

```tsx
const trend = chart({
  x: { numeric: budget },
  y: { measure: endToEndPassRate },
  series: [{
    key: "pass-rate",
    mark: "line",
    measure: endToEndPassRate,
    by: "agent",
  }],
});

<Chart source={trend} legend tooltip />
```

缺点默认断线。需要跨缺失点连线时在 `Chart` 的 `series["pass-rate"]` 呈现覆盖中显式声明
`connectNulls: true`；它只改变线段，不制造 MeasureCell。

## 相关阅读

- [`Chart`](README.md) —— 数据源、Content、轴与两面契约。
