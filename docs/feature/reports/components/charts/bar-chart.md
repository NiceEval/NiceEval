# `mark: "bar"`

柱用于排行、分组或可相加的堆叠：

```tsx
const ranking = sources.measure.rows({
  dimensions: [["agent", label("memory")]],
  measures: [passRate],
});

<Chart
  source={ranking}
  x="passRate"
  y={{
    field: "agent × memory",
    sort: "passRate",
    limit: 10,
  }}
  layout="vertical"
>
  <Series id="pass-rate" mark="bar" />
</Chart>
```

`limit` 只隐藏排名以外的柱，不生成“其他”。需要合并长尾时，先用自定义 Dimension 定义分桶，
让 Source 从 Attempt 重新聚合。同一 `stack` 的读数必须可相加并绑定同一对轴。
逐柱取色按页级 `(dimension, value)` 映射，不用显示标签作为颜色键。

## 相关阅读

- [`Chart`](README.md) —— Dataset、字段映射、轴与两面契约。
