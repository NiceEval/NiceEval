# `LineChart`

数值参数趋势或维度折线的容器；唯一 series 是 [`Line`](#line)。容器 props、轴绑定、`ChartData`、聚合与两面投影规则见[图表](README.md)。

```tsx
<LineChart input={scope}>
  <XAxis numeric={budget} />
  <YAxis metric={endToEndPassRate} />
  <Line metric={endToEndPassRate} by="agent" />
</LineChart>
```

## `Line`

```ts
type LineProps = MetricSeriesBinding & {
  name?: LocalizedText;
  type?: "linear" | "monotone" | "step";
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  dot?: DotPresentation;
  activeDot?: DotPresentation;
  label?: LabelPresentation;
  connectNulls?: boolean;
};
```

`connectNulls` 默认 `false`；开启时只跨缺失值连线，不会为缺失点制造 `MetricCell`。

`Line` 的绑定形态（`by` / `value`）、`dataKey` 规则见[共用选择模型](README.md#共用选择模型)；`ErrorBar`、`LabelList`、`Cell`、`Label` 等子节点见[嵌套节点](README.md#嵌套节点)。

## 相关阅读

- [图表](README.md) —— 容器、轴、计算规格、`ChartData` 与两面投影。
- [`BarChart`](bar-chart.md) / [`AreaChart`](area-chart.md) / [`ScatterChart`](scatter-chart.md) / [`ComposedChart`](composed-chart.md) —— 其它容器与 series。
