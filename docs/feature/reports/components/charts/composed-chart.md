# 混合 mark

`Chart` 天然接受多种 mark，不另设混合容器：

```tsx
const qualityAndCost = sources.measure.rows({
  dimensions: ["experiment"],
  measures: [plannerCostUSD, workerCostUSD, passRate],
});

<Chart
  source={qualityAndCost}
  x="experiment"
  y={[
    { id: "cost", field: "plannerCostUSD" },
    { id: "quality", field: "passRate" },
  ]}
  legend
  tooltip
  grid
>
  <Series id="planner-cost" mark="bar" y="plannerCostUSD" yAxis="cost" stack="cost" />
  <Series id="worker-cost" mark="bar" y="workerCostUSD" yAxis="cost" stack="cost" />
  <Series id="quality" mark="line" y="passRate" yAxis="quality" />
</Chart>
```

多个轴必须具名；每条 series 显式绑定轴。省略绑定只在对应方向恰好一个轴时合法，不按单位猜轴。

## 相关阅读

- [`Chart`](README.md) —— Dataset、字段映射、轴与两面契约。
