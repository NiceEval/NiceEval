# `mark: "area"`

面积用于强调累计量或区间。它是 series 的 mark，不是折线容器上的布尔开关：

```tsx
const usage = chart({
  x: { numeric: budget },
  y: { measure: tokens },
  series: [{
    key: "tokens",
    mark: "area",
    measure: tokens,
    by: "agent",
  }],
});

<Chart source={usage} legend />
```

只有可相加且同轴的面积 series 才能共用 `stack`。缺点默认断开，不把缺失当零填满面积。

## 相关阅读

- [`Chart`](README.md) —— 数据源、Content、轴与两面契约。
