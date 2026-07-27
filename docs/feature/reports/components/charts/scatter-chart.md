# `mark: "scatter"`

散点用于两个 Measure 的点云或前沿。`points` 定义点身份，`by` 定义可选的 series 身份：

```tsx
const frontier = sources.measure.rows({
  dimensions: ["experiment", "agent"],
  measures: [costUSD, passRate],
});

<Chart source={frontier} x="costUSD" y="passRate" legend tooltip>
  <Series id="frontier" mark="scatter" points="experiment" by="agent" />
</Chart>
```

`connect` 只用于“同一 lineage 的有序变体”，并在每条解析后 series 内按 x 原值连线。
无关点之间没有天然顺序，默认不连线。数值参数的连续趋势优先用 line mark。

## 相关阅读

- [`Chart`](README.md) —— Dataset、字段映射、轴与两面契约。
