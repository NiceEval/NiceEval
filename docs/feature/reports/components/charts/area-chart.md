# `mark: "area"`

面积用于强调累计量或区间。它是 series 的 mark，不是折线容器上的布尔开关：

```tsx
const usage = sources.measure.rows({
  dimensions: [budget, "agent"],
  measures: [tokens],
});

<Chart source={usage} x="budget" y="tokens" legend>
  <Series id="tokens" mark="area" by="agent" />
</Chart>
```

只有可相加且同轴的面积 series 才能共用 `stack`。缺点默认断开，不把缺失当零填满面积。

## 相关阅读

- [`Chart`](README.md) —— Dataset、字段映射、轴与两面契约。
