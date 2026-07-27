# `Chart`

`Chart` 是唯一图表原语。它只消费 `ChartContent`；`chart(options)` 数据源负责把 `Measure`、
`Dimension` 与 `NumericAxis` 聚合成轴和 series。折线、柱、面积与散点是 series 的 `mark`，
不是四套容器；同一坐标系混合 mark 也不需要另一种混合容器。

```tsx
const qualityCost = chart({
  x: { measure: costUSD },
  y: { measure: endToEndPassRate },
  series: [{
    key: "frontier",
    mark: "scatter",
    points: "experiment",
    by: "agent",
    x: costUSD,
    y: endToEndPassRate,
  }],
});

<Chart source={qualityCost} legend tooltip />
```

手工计算与其它原语完全同形：

```tsx
const content = await qualityCost.compute(sample);
<Chart data={content} legend tooltip />
```

## 数据源

```ts
type AxisBinding =
  | {
      id?: string;
      dimension: DimensionInput;
      sort?: Measure;
      limit?: number;
      rest?: LocalizedText;
    }
  | { id?: string; numeric: NumericAxis }
  | { id?: string; measure: Measure };

interface MeasureSeries {
  key: string;
  mark: "line" | "bar" | "area";
  measure: Measure;
  /** 省略时一条 series；声明后每个维度值一条。 */
  by?: DimensionInput;
  /** 只保留这个维度值；与 by 互斥。 */
  value?: string;
  yAxis?: string;
  stack?: string;
}

interface ScatterSeries {
  key: string;
  mark: "scatter";
  points: DimensionInput;
  x: Measure;
  y: Measure;
  by?: DimensionInput;
  value?: string;
  xAxis?: string;
  yAxis?: string;
  /** 只对同族有序变体连线。 */
  connect?: boolean;
}

type ChartSeries = MeasureSeries | ScatterSeries;

interface ChartOptions {
  x: AxisBinding | readonly [AxisBinding, ...AxisBinding[]];
  y: AxisBinding | readonly [AxisBinding, ...AxisBinding[]];
  series: readonly [ChartSeries, ...ChartSeries[]];
}

function chart(
  options: ChartOptions,
): DataSource<ChartContent, Sample | readonly Run[]>;
```

`chart()` 只建立声明，不读取 Record。series `key` 在一张图内唯一，是 Content 与呈现覆盖的稳定身份，
不是对象属性路径。动态 `by` 解析成多条可见 series，但仍归属同一个声明 key。

`evals` 属于 `Chart` 的 source 形态，在聚合前收窄题集，不进入 `ChartOptions`。

## 原语

```ts
type ChartProps =
  | ({ source: DataSource<ChartContent, Sample | readonly Run[]>; data?: never }
      & ChartPresentation)
  | ({ data: ChartContent; source?: never; input?: never; evals?: never }
      & ChartPresentation);

interface ChartPresentation {
  input?: Sample | readonly Run[];
  evals?: string | readonly string[];
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout?: "horizontal" | "vertical";
  legend?: boolean;
  tooltip?: boolean;
  grid?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
  series?: Readonly<Record<string, SeriesPresentation>>;
}
```

`series` 只覆盖颜色、线型、点形、标签与是否显示，不改变绑定、聚合或 mark。数据不存在的 key
按完整用户反馈报错；要增加或删除 series，改 `chart()` 声明。

## Content

```ts
interface ChartContent {
  axes: readonly ChartAxis[];
  series: readonly ChartSeriesContent[];
  points: readonly ChartPoint[];
}

interface ChartPoint {
  key: string;
  series: string;
  x: DimensionValue | MeasureCell;
  y: DimensionValue | MeasureCell;
  refs: readonly AttemptLocator[];
}
```

Content 保留每个点的 `MeasureCell.samples`、`total` 与 `refs`。原语不从显示字符串重算数值，也不在
tooltip 打开时读取 artifact。

## 聚合与缺失

- 读数仍先按 experiment × eval 做 `perEval`，再跨题做 `acrossEvals`。
- `null` 不参与聚合；缺点不伪造为 0。
- 维度轴的 `sort` 跟随 Measure 的 `better`；`limit` 要求同时给 `sort`。
- `rest` 对被截掉的原始成员重新聚合，不平均已经聚合好的点。
- 同一 stack 必须绑定同一对轴，而且 Measure 可相加。
- `scatter.connect` 只在每条解析后 series 内按 x 原值连线；默认 `false`。

## 轴方向与值域

`better: "lower"` 的数值轴反向，`better: "higher"` 正向，使“更好”恒朝右或上。未声明
`better` 时不猜方向。值域在数据极值外留呼吸边距，并受 Measure `bounds` 限制；通过率等有自然量程
的读数还使用最小可见跨度，避免把微小噪声撑满整图。

## 两面

- web 面输出真实 SVG/DOM、图例、tooltip 与证据链接；无 JavaScript 时标签与数值仍可读。
- text 面按同一 Content 画字符坐标图；空间不足时保留轴、series 名与精确值表，不删除 series。
- 页级色分配以 `(dimension, value)` 为键，同一个 agent 在 Chart 与 Table 中恒同色。

## Mark 指南

- [line](line-chart.md) —— 数值趋势或有序维度。
- [bar](bar-chart.md) —— 排行、分组与堆叠。
- [area](area-chart.md) —— 累计量或区间。
- [scatter](scatter-chart.md) —— 两个 Measure 的点云与前沿。
- [混合 mark](composed-chart.md) —— 同一坐标系组合多种 mark。

## 相关阅读

- [组件树](../README.md) —— 数据源、原语与组合组件的边界。
- [读数与维度](../../library/measures.md) —— Measure、Dimension 与 NumericAxis。
