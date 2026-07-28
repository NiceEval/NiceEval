# `Chart`

`Chart` 是唯一图表原语。它消费 `sources.measure.rows(...)` 返回的通用 `Dataset`，再由组件 props
把字段映射到坐标、series 与 mark。Source 只选择 Dimension、计算 Measure 和聚合事实；x / y、
`mark`、`by`、`points`、`stack` 与 `connect` 都是显示决定，不另设图表 Source 或图表专用 Content。

```tsx
const qualityCost = sources.measure.rows({
  dimensions: ["experiment", "agent"],
  measures: [costUSD, passRate],
});

<Chart source={qualityCost} x="costUSD" y="passRate" legend tooltip>
  <Series id="frontier" mark="scatter" points="experiment" by="agent" />
</Chart>
```

手工计算与其它原语完全同形：

```tsx
const data = await qualityCost.compute(sample);

<Chart data={data} x="costUSD" y="passRate" legend tooltip>
  <Series id="frontier" mark="scatter" points="experiment" by="agent" />
</Chart>
```

同一份 Dataset 也可以直接交给 `Table`。从表改成图或在两个视图间切换，不会触发第二套聚合协议。

## Dataset

Chart 只按稳定字段名绑定 Dataset：

```ts
type FieldName = string;

interface ChartFieldBinding {
  id?: string;
  field: FieldName;
  sort?: FieldName;
  limit?: number;
}

type ChartAxisBinding = FieldName | ChartFieldBinding;
```

`field` 必须出现在 `Dataset.fields` 中。dimension 字段提供离散类别或数值条件，measure 字段提供
`MeasureCell`；Chart 不接受 `Measure`、`DimensionInput` 或 `NumericDimension` 对象，也不重新读取 Record。
数值 flag / label 先作为 Dimension 交给 `sources.measure.rows(...)`，Dataset 的字段描述保存其数值语义，
Chart 再按字段名把它绑定到轴。

聚合前的题集选择、Dimension 和 Measure 属于 Source options 或显式 input，不进入 Chart props。

## 原语

```ts
type ChartProps<Input extends SourceInput> = DataProps<Input, Dataset> & {
  x: ChartAxisBinding | readonly [ChartAxisBinding, ...ChartAxisBinding[]];
  y: ChartAxisBinding | readonly [ChartAxisBinding, ...ChartAxisBinding[]];
  children: SeriesNode | readonly SeriesNode[];
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
};

interface SeriesProps {
  id: string;
  mark: "line" | "bar" | "area" | "scatter";
  /** 默认继承 Chart 的 x / y；混合轴时可逐 series 覆盖。 */
  x?: FieldName;
  y?: FieldName;
  /** Dataset 中定义点身份的 dimension 字段。 */
  points?: FieldName;
  /** Dataset 中拆分可见 series 的 dimension 字段。 */
  by?: FieldName;
  /** 只保留 by 字段的一个完整值。 */
  value?: string;
  xAxis?: string;
  yAxis?: string;
  stack?: string;
  connect?: boolean;
  connectNulls?: boolean;
  hidden?: boolean;
  label?: LocalizedText;
  color?: string;
  line?: "solid" | "dashed" | "dotted";
  point?: "circle" | "square" | "diamond";
}
```

`Series` 是 Chart 的结构节点，不取数、不聚合，也不单独渲染。`id` 在一张图内唯一，是呈现覆盖与
错误定位的稳定身份，不是 Dataset 属性路径。`by` 会把一个声明展开成多条可见 series，但仍归属同一
`id`。

字段不存在、字段类型不适用于当前 mark，或 Dataset 中出现同名字段时，Chart 按完整用户反馈报错。
要增加、删除或改变 series，只改 `<Series>`；Dataset 仍是可被其它组件复用的事实投影。

## 映射与证据

Chart 在渲染前同步把 Dataset 行映射成内部点集合。这个内部模型不是 Source Content，也不进入公开的
序列化协议：

- dimension cell 保留完整值作为点、series、排序与下钻身份；
- measure cell 原样保留 `value`、`display`、`samples`、`total` 与 `refs`；
- tooltip 和证据链接只读取已有 cell，不在交互时访问 artifact；
- 点与 tooltip 的显示字符串取自 `display`，轴刻度用 `formatAxisTick`；两者都不反向参与数值或身份计算。

同一 Dataset 可以配不同 Chart 映射。例如相同的 `experiment + agent + costUSD + passRate`，既可以画
质量成本散点，也可以按 agent 画成本柱状图；两者不需要复制或重算数据。

## 聚合与缺失

- 聚合完全由 `sources.measure.rows(...)` 完成：先按 experiment × eval 做 `perEval`，再跨题做
  `acrossEvals`。
- `null` 不参与聚合；缺点不伪造为 0。
- 维度轴的 `sort` 绑定 Dataset 中的 measure 字段，并跟随其 `better`；`limit` 要求同时给 `sort`。
- `limit` 只隐藏排序后的多余类别，不生成“其他”聚合桶。需要合并类别时，把分桶规则定义成
  Dimension，让 Source 按原始 Attempt 重新聚合；Chart 不从已经聚合好的 Dataset 行二次算数。
- 同一 stack 必须绑定同一对轴，而且 measure 可相加。
- `connect` 只在每条解析后的 series 内按 x 原值连线；默认 `false`。

## 轴方向与值域

measure 字段 `better: "lower"` 的数值轴反向，`better: "higher"` 正向，使“更好”恒朝右或上。
未声明 `better` 时不猜方向。值域在数据极值外留呼吸边距，并受字段 `bounds` 限制；通过率等有自然
量程的读数还使用最小可见跨度，避免把微小噪声撑满整图。

## 两面

- web 面输出真实 SVG/DOM、图例、tooltip 与证据链接；无 JavaScript 时标签与数值仍可读。
- text 面从同一 Dataset 与同一映射画字符坐标图；空间不足时保留轴、series 名与精确值表，不删除
  series。
- 页级视觉编码以 `(dimension, value)` 为键，同一个 agent 在 Chart 与 Table 中恒同身份。

## 实验呈现

Chart 保留完整 experiment id 作为点、series、排序与下钻身份。组件在 `dimensions()` 里以
`encoding: { kind: "series", mark }` 声明完整 id 集合。
renderer 再用 `ctx.dimension(handle).at(index)` 取得完整身份、页内最短唯一标签，
以及已经消解撞槽的颜色加线型 / 形状 / pattern。
不能逐个截路径末段，也不能按数组下标自行配色。

自有 React 页面没有报告管线，调用 `presentDimension(declaration)` 传入同形状的声明，
再按下标读取同一种 `DimensionPresentation`。

## Mark 指南

- [line](line-chart.md) —— 数值趋势或有序维度。
- [bar](bar-chart.md) —— 排行、分组与堆叠。
- [area](area-chart.md) —— 累计量或区间。
- [scatter](scatter-chart.md) —— 两个 Measure 的点云与前沿。
- [混合 mark](composed-chart.md) —— 同一坐标系组合多种 mark。

## 相关阅读

- [组件树](../README.md) —— Source、Component 与组合组件的边界。
- [读数与维度](../../library/measures.md) —— Dataset、Measure 与 Dimension。
