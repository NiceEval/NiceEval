# `mark: "bar"`

柱用于排行、分组或可相加的堆叠：

```tsx
const ranking = chart({
  x: { measure: endToEndPassRate },
  y: {
    dimension: ["agent", label("memory")],
    sort: endToEndPassRate,
    limit: 10,
    rest: "其余",
  },
  series: [{
    key: "pass-rate",
    mark: "bar",
    measure: endToEndPassRate,
  }],
});

<Chart source={ranking} layout="vertical" />
```

`rest` 对被截掉的原始成员重新聚合，不平均柱高。同一 `stack` 的读数必须可相加并绑定同一对轴。
逐柱取色按页级 `(dimension, value)` 映射，不用显示标签作为颜色键。

## 相关阅读

- [`Chart`](README.md) —— 数据源、Content、轴与两面契约。
