# `ComposedChart`

同一坐标系混合多种 series 的容器：接受 [`Line`](line-chart.md#line)、[`Bar`](bar-chart.md#bar)、[`Area`](area-chart.md#area)、[`Scatter`](scatter-chart.md#scatter) 的任意组合，各自 props 与绑定规则见对应文档。容器 props、轴绑定、`ChartData`、聚合与两面投影规则见[图表](README.md)。

```tsx
<ComposedChart input={sample}>
  <CartesianGrid />
  <XAxis dimension="experiment" />
  <YAxis yAxisId="cost" metric={costUSD} />
  <YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
  <Tooltip />
  <Legend />

  <Bar metric={plannerCostUSD} stackId="cost" yAxisId="cost">
    <ErrorBar kind="ci95" />
  </Bar>
  <Bar metric={workerCostUSD} stackId="cost" yAxisId="cost" />
  <Line metric={endToEndPassRate} yAxisId="quality" dot={false} />
  <ReferenceLine y={0.8} yAxisId="quality" label="目标" />
</ComposedChart>
```

## 相关阅读

- [图表](README.md) —— 容器、轴、计算规格、`ChartData` 与两面投影。
- [`LineChart`](line-chart.md) / [`BarChart`](bar-chart.md) / [`AreaChart`](area-chart.md) / [`ScatterChart`](scatter-chart.md) —— 单一 series 类型的容器。
