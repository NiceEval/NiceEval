# `AreaChart`

强调累计量或区间的面积图容器；唯一 series 是 [`Area`](#area)。容器 props、轴绑定、`ChartData`、聚合与两面投影规则见[图表](README.md)。

## `Area`

```ts
type AreaProps = MetricSeriesBinding & {
  name?: LocalizedText;
  stackId?: string | number;
  type?: "linear" | "monotone" | "step";
  stroke?: string;
  fill?: string;
  fillOpacity?: number;
  dot?: DotPresentation;
  label?: LabelPresentation;
  connectNulls?: boolean;
};
```

面积是独立 series 类型，不是折线上的布尔开关；因此它有自己的类型、props 与合法 children。

`Area` 的绑定形态（`by` / `value`）、`dataKey` 规则见[共用选择模型](README.md#共用选择模型)；`LabelList`、`Cell`、`Label` 等子节点见[嵌套节点](README.md#嵌套节点)。

## 相关阅读

- [图表](README.md) —— 容器、轴、计算规格、`ChartData` 与两面投影。
- [`LineChart`](line-chart.md) / [`BarChart`](bar-chart.md) / [`ScatterChart`](scatter-chart.md) / [`ComposedChart`](composed-chart.md) —— 其它容器与 series。
