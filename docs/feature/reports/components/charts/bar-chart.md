# `BarChart`

排行、分组柱与堆叠柱的容器；唯一 series 是 [`Bar`](#bar)。容器 props、轴绑定、`ChartData`、聚合与两面投影规则见[图表](README.md)。

```tsx
<BarChart layout="vertical">
  <XAxis metric={endToEndPassRate} orientation="top" />
  <YAxis dimension={["agent", label("memory")]} sort={endToEndPassRate} limit={10} rest="其余" />
  <Bar metric={endToEndPassRate} colorBy={label("memory")}>
    <LabelList position="right" />
  </Bar>
</BarChart>
```

## `Bar`

```ts
type BarProps = MetricSeriesBinding & {
  name?: LocalizedText;
  stackId?: string | number;
  /** 每根柱按这个维度取页级色；省略时整条 series 一个颜色。 */
  colorBy?: DimensionInput;
  fill?: string;
  stroke?: string;
  maxBarSize?: number;
  radius?: number | readonly [number, number, number, number];
  label?: LabelPresentation;
};
```

同一 stack 必须绑定同一对轴且 Metric 可相加；柱顶总值用 `<LabelList value="stackTotal" position="top" />` 显式声明，不作为无法关闭的隐式装饰。

`colorBy` 解决「行身份是一回事、颜色要表达另一回事」：每根柱的身份是「agent 线 × 记忆机制」，而颜色要说的是记忆机制。它取的是[页级色映射](../README.md#系列色分配单位是页)里 `(该维度, 该柱的维度值)` 的颜色，因此同一个记忆机制在这张图、图例和页上任何按同一维度取色的地方恒同色，深浅主题也跟着走。

`colorBy` 的维度必须能从每根柱的位置唯一确定取值——它是位置维度本身，或位置维度的一个成员（复合维度的成员），否则一根柱对应多个取值，按完整用户反馈报错并列出冲突的取值。要给具体某个取值指定颜色而不是让它自动分配，用[主题层的钉色](../../library/theme.md#钉色)；要单独强调一两根柱而不引入第二个维度，用 [`Cell`](README.md#cell)。

`Bar` 的绑定形态（`by` / `value`）、`dataKey` 规则见[共用选择模型](README.md#共用选择模型)；`ErrorBar`、`LabelList`、`Cell`、`Label` 等子节点见[嵌套节点](README.md#嵌套节点)。

## 相关阅读

- [图表](README.md) —— 容器、轴、计算规格、`ChartData` 与两面投影。
- [`LineChart`](line-chart.md) / [`AreaChart`](area-chart.md) / [`ScatterChart`](scatter-chart.md) / [`ComposedChart`](composed-chart.md) —— 其它容器与 series。
