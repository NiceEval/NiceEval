# 混合 mark

`Chart` 天然接受多种 mark，不另设混合容器：

```tsx
const qualityAndCost = chart({
  x: { dimension: "experiment" },
  y: [
    { id: "cost", measure: costUSD },
    { id: "quality", measure: endToEndPassRate },
  ],
  series: [
    {
      key: "planner-cost",
      mark: "bar",
      measure: plannerCostUSD,
      yAxis: "cost",
      stack: "cost",
    },
    {
      key: "worker-cost",
      mark: "bar",
      measure: workerCostUSD,
      yAxis: "cost",
      stack: "cost",
    },
    {
      key: "quality",
      mark: "line",
      measure: endToEndPassRate,
      yAxis: "quality",
    },
  ],
});

<Chart source={qualityAndCost} legend tooltip grid />
```

多个轴必须具名；每条 series 显式绑定轴。省略绑定只在对应方向恰好一个轴时合法，不按单位猜轴。

## 相关阅读

- [`Chart`](README.md) —— 数据源、Content、轴与两面契约。
