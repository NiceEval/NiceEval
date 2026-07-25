# `ScatterChart`

两个 Metric 的点云或前沿容器；唯一 series 是 [`Scatter`](#scatter)。容器 props、轴绑定、`ChartData`、聚合与两面投影规则见[图表](README.md)。

```tsx
<ScatterChart>
  <XAxis metric={costUSD} />
  <YAxis metric={endToEndPassRate} />
  <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} line />
</ScatterChart>
```

## `Scatter`

```ts
type ScatterBinding =
  | ({ points: DimensionInput; x: Metric; y: Metric; dataKey?: string } & SeriesSelection)
  | { dataKey: string; points?: never; x?: never; y?: never; by?: never; value?: never };

type ScatterProps = ScatterBinding & {
  name?: LocalizedText;
  xAxisId?: string | number;
  yAxisId?: string | number;
  line?: boolean | ScatterLinePresentation;
  shape?: ShapePresentation;
};
```

`points` 定义点身份，`by` 定义可选的 series 维度。`line` 开启后每个解析后 series 内按 x 原始值升序连线——只给「线 = 同族变体」的 lineage series 用：基线与加了某个机制的变体同线，连线显示位移。散点云之间没有天然顺序，对无关点连线只会画出虚构趋势；表达数值参数的进程用数值 [`XAxis`](README.md#xaxis) 的折线。

散点直接消费调用方给出的 Sample，不根据 experiment id 隐式分区。

`Scatter` 的绑定形态（`by` / `value`）见[共用选择模型](README.md#共用选择模型)；`ErrorBar`、`LabelList`、`Cell`、`Label` 等子节点见[嵌套节点](README.md#嵌套节点)。

## 相关阅读

- [图表](README.md) —— 容器、轴、计算规格、`ChartData` 与两面投影。
- [`LineChart`](line-chart.md) / [`BarChart`](bar-chart.md) / [`AreaChart`](area-chart.md) / [`ComposedChart`](composed-chart.md) —— 其它容器与 series。
