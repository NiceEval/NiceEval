# 图表

图表把 [指标](../library/metrics.md) 投影成折线、柱、面积、散点与它们的混合。一张图是一棵树：容器持有共享坐标系，轴与 series 是容器的子节点，误差线、数值标签和单项覆盖又属于具体 series。组合模型与结构节点规则见[组件树](README.md)，真实图例见 [Gallery](gallery.md)。

```tsx
<ComposedChart input={scope}>
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

niceeval 的扩展只在数据语义上：容器用 `input` 接收 [`ReportInput`](../library/metrics.md#公开计算模型)，不接收作者预聚合的裸对象数组；轴与 series 用 Metric、Dimension、NumericAxis 绑定，不用对象属性路径取值；聚合结果保留 `MetricCell.samples` / `refs`，由同一份 `ChartData` 驱动 text 与 web 两面。

## 容器

| 容器 | 直接 series 子节点 | 用途 |
|---|---|---|
| `LineChart` | `Line` | 数值参数趋势或维度折线 |
| `BarChart` | `Bar` | 排行、分组柱与堆叠柱 |
| `AreaChart` | `Area` | 强调累计量或区间的面积图 |
| `ScatterChart` | `Scatter` | 两个 Metric 的点云或前沿 |
| `ComposedChart` | `Line` / `Bar` / `Area` / `Scatter` | 同一坐标系混合多种 series |

图表类型由 JSX 元素名表达，不用字符串 `as`；容器的 children 是唯一的轴、series 与呈现声明。

```ts
interface ChartPresentationProps {
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout?: "horizontal" | "vertical";
  margin?: Partial<{ top: number; right: number; bottom: number; left: number }>;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

type ChartProps =
  | ({ data: ChartData; input?: never; evals?: never; children: ChartChild | readonly ChartChild[] } & ChartPresentationProps)
  | ({ input?: ReportInput; evals?: string | readonly string[]; data?: never; children: ChartChild | readonly ChartChild[] } & ChartPresentationProps);
```

```tsx
<LineChart input={scope}>
  <XAxis numeric={budget} />
  <YAxis metric={endToEndPassRate} />
  <Line metric={endToEndPassRate} by="agent" />
</LineChart>
```

## 呈现别名

轴、series 与嵌套节点上以 `Presentation` 结尾的 props 都是[双面投影阶梯](README.md#双面投影边界)的实例——`Presentation<该节点的渲染数据, 该节点的默认呈现字段>`。因此每一处都是同样四档：`false` 关掉、部分字段对象只调样式与位置、函数接管 web 面、`{ web, text }` 同时接管两面。渲染回调只收到解析后的只读数据片段，不能触发第二次聚合。

| 别名 | 出现在 | 渲染数据 |
|---|---|---|
| `TickPresentation` | `XAxis.tick` / `YAxis.tick` | `{ value, label, index, count }`：`value` 是维度值或数值原值，`label` 是默认刻度文案，`index` 是该刻度在轴顺序里的下标 |
| `LabelPresentation` | 轴、`Reference*` 与 `Line` / `Bar` / `Area` 的 `label` | `{ value, label }`；series 上逐图形项调用，轴与参考标注上只调一次。额外接受 `LocalizedText` 短写，与单个 `<Label value="…" />` 等价 |
| `DotPresentation` | `Line.dot` / `Line.activeDot` / `Area.dot` | `{ cell, seriesKey }` |
| `ShapePresentation` | `Scatter.shape` | `{ cell, seriesKey, pointKey }` |
| `ScatterLinePresentation` | `Scatter.line` | `{ seriesKey, points }` |

`index` 跟随轴解析后的顺序——`sort` 之后、`reversed` 之前，所以排序过的维度轴上 `index` 就是名次。名次序号因此是刻度的呈现定制，不是新的绑定：

```tsx
<YAxis
  dimension="agent"
  sort={endToEndPassRate}
  tick={{
    web: ({ label, index }) => <tspan>{`#${index + 1}  ${label}`}</tspan>,
    text: ({ label, index }) => `#${index + 1}  ${label}`,
  }}
/>
```

## 轴

### `XAxis`

三个互斥绑定：

```ts
type DimensionAxisBinding = {
  dimension: DimensionInput;
  /** 稳定排序的依据；必须是图中已声明且有 better 的 Metric。 */
  sort?: Metric;
  /** 只保留排序后的前 N 个维度值；要求同时给出 sort。 */
  limit?: number;
  /** limit 截掉的维度值聚成一条，用这个名字；省略时直接截断。 */
  rest?: LocalizedText;
};

type XAxisBinding =
  | (DimensionAxisBinding & { numeric?: never; metric?: never })
  | { numeric: NumericAxis; dimension?: never; metric?: never; sort?: never; limit?: never; rest?: never }
  | { metric: Metric; dimension?: never; numeric?: never; sort?: never; limit?: never; rest?: never };

interface XAxisPresentationProps {
  xAxisId?: string | number;
  orientation?: "top" | "bottom";
  reversed?: boolean;
  domain?: readonly [number | "auto", number | "auto"];
  tick?: TickPresentation;
  label?: LabelPresentation;
}

type XAxisProps =
  | (XAxisBinding & XAxisPresentationProps)
  | ({ xAxisId: string | number; dimension?: never; numeric?: never; metric?: never; sort?: never; limit?: never; rest?: never } & XAxisPresentationProps);
```

- `dimension` 是分类轴，用于排行、分组柱或按离散配置比较。传数组即[复合维度](../library/metrics.md#维度与数值轴)——`["agent", label("memory")]` 的一个取值是一根柱，不是两根。
- `numeric` 是 [`NumericAxis`](../library/metrics.md#维度与数值轴)，用于参数趋势；每个点保留数值原值和等价显示值。字符串配置必须显式映射到数值，组件不猜 `low < medium < high`。
- `metric` 是散点图横轴；格式、bounds 与 `better` 来自 Metric。
- `sort` / `limit` / `rest` 只属于维度轴，规则见[排序与截断](#排序与截断)。

`xAxisId` 默认 `0`。显式呈现 props 覆盖默认呈现，不改变聚合数据。

### `YAxis`

```ts
type YAxisBinding =
  | { metric: Metric; dimension?: never; sort?: never; limit?: never; rest?: never }
  | (DimensionAxisBinding & { metric?: never });

interface YAxisPresentationProps {
  yAxisId?: string | number;
  orientation?: "left" | "right";
  reversed?: boolean;
  domain?: readonly [number | "auto", number | "auto"];
  tick?: TickPresentation;
  label?: LabelPresentation;
}

type YAxisProps =
  | (YAxisBinding & YAxisPresentationProps)
  | ({ yAxisId: string | number; dimension?: never; metric?: never; sort?: never; limit?: never; rest?: never } & YAxisPresentationProps);
```

`metric` 是数值轴的完整语义声明，不是可省略的格式提示：它提供 label、单位、bounds、显示格式与 `better`。`dimension` 用于 `BarChart layout="vertical"` 的纵向分类轴，排序与截断规则与维度 `XAxis` 相同。series 通过 `yAxisId` 显式绑定，双轴不靠猜：

```tsx
<YAxis yAxisId="cost" metric={costUSD} />
<YAxis yAxisId="quality" metric={endToEndPassRate} orientation="right" />
<Bar metric={costUSD} yAxisId="cost" />
<Line metric={endToEndPassRate} yAxisId="quality" />
```

data 形态下轴绑定已经在 `ChartData` 里，`XAxis` / `YAxis` 只按 id 给对应轴附加呈现，不得再给 `dimension`、`numeric` 或 `metric`。

### 轴引用与兼容性

轴 id 省略时引用 id `0`；每个引用必须恰好命中一个同向轴。

- 维度 `XAxis` 可承载 `Line` / `Bar` / `Area`；数值 `XAxis` 承载趋势 series；Metric `XAxis` 承载 `Scatter` 的 x 值。
- 分配到 Metric 轴的 series metric 必须与其单位、格式、bounds 和方向兼容。常规布局的 Metric 轴是 Y，`BarChart layout="vertical"` 的 Metric 轴是 X。
- `Scatter` 的 `x` / `y` 必须分别与所绑定 X / Y 轴的 Metric 相同；其它 series 的 `metric` 必须与 Y 轴 Metric 相同，或通过 Metric 的显式轴兼容声明证明同单位同尺度。
- 同一个 `stackId` 只允许绑定同一对轴的 `Bar` / `Area`，堆中指标必须可相加。字符串恰好相同不能越过单位或尺度校验。

### 排序与截断

`sort` 必须绑定图中一个已声明且有 `better` 的 Metric；方向跟随 `better`，同值以维度 key 稳定收口。省略 `sort` 时维度值按稳定 key 字典序。

`limit` 只保留排序后的前 N 个维度值。榜单一长就要截断，而截断只能由组件做：聚合发生在计算函数内部，事后拿到的是已聚合的行，从中还原不出「被截掉那些合起来是多少」。规则：

- **`limit` 要求同时给出 `sort`。** 没有排序就没有「前 N」，只给 `limit` 按完整用户反馈报错。
- **`rest` 是重新聚合，不是把截掉的几行平均。** 给了 `rest` 时被截掉的维度值合成一个组，在合并后的 keyset 上走同一套两级聚合——它回答「其余那些 attempt 合起来是多少」。省略 `rest` 就是直接截断，图上不出现被截掉的值。
- **`rest` 恒排在末位**，不参与 `sort` 的比较；它的 `MetricCell` 带自己的 `samples` / `total` / `refs`，与其它条同口径，因此也能下钻到证据。
- **维度值数量不超过 `limit` 时不产生 `rest` 条目**，不画一条空的「其余」。
- `limit` 小于 1 或非整数按完整用户反馈报错。

### 轴方向

**「更好」恒指向右与上。** `better: "lower"` 的轴反向渲染（成本轴左贵右便宜），`better: "higher"` 正向；角落提示因此恒为「越靠右上越好」。刻度标签始终显示真实值，反向只改方向不改数字；未声明 `better` 的轴正向渲染，且该图不出方向提示——组件不猜「更好」朝哪边。text 与 web 两面同一规则。

### 值域

数值轴的值域分两步推定：

**呼吸边距**：数据极值向两端各扩数据跨度的 20%，数据极值点不落在绘图框线上。落在框线上的点标记被框线穿过、视觉上残缺，而极值点（最好与最差）恰是图上最需要被完整看清的点；边距同时给极值点旁的文字标签留出排布空间。数据跨度为零（单点，或全部点同值）时，边距改取该值绝对值的 20%；值恰为 0 时取 1。

**最小跨度下限**：扩完边距后，值域跨度不得小于量程参考的 1/3。值域若永远贴着数据画，数据聚集时微小差距会撑满整个绘图区，读者把噪声读成显著差异；下限保证 1 个单位的差距在图上占的比例有上界。不足下限时以数据为中心向两端对称扩展补足，一端被 `bounds` 顶住时余量推到另一端。量程参考取自指标声明的 `bounds`（自然边界，见[指标](../library/metrics.md)）：两端都声明时为 bounds 全量程——通过率的参考是 0–100%，值域至少画 33 个百分点；只声明一端时为声明端到数据另一侧极值的距离——成本的参考是 $0 到数据最大值；两端都未声明的轴（数值 `XAxis`）没有量程参考，不适用下限。

声明了 `bounds` 的轴，边距与下限扩展都截到边界为止：通过率 100% 的点落在框线上是「顶到语义天花板」的如实呈现，不是裁剪——此时框线就是指标的自然边界。

值域是呈现：它不改变 `ChartData`，不产生假刻度——刻度取扩后值域内的整值、标签始终显示真实值；反向轴先扩边距再反向。显式 `domain` 覆盖这两步。text 面的字符坐标图共用同一份值域，按字符行列粒度取整。

## Series

### 共用选择模型

`Line`、`Bar`、`Area` 共用两种绑定形态：

```ts
type SeriesSelection =
  | { by?: never; value?: never }
  | { by: DimensionInput; value?: never }
  | { by: DimensionInput; value: string };

interface SeriesAxisBinding {
  xAxisId?: string | number;
  yAxisId?: string | number;
}

type MetricSeriesBinding =
  | ({ metric: Metric; dataKey?: string } & SeriesSelection & SeriesAxisBinding)
  | ({ dataKey: string; metric?: never; by?: never; value?: never } & SeriesAxisBinding);
```

- 不给 `by`：一个 Metric 形成一个 series。
- 只给 `by`：按该维度的已观测 domain 动态展开多个 series。传数组时解析为[复合维度](../library/metrics.md#维度与数值轴)。
- 同给 `by` 与 `value`：精确选择这个维度值，适合逐 series 定制。

`value` 永远不能单独出现，也不猜它属于 agent、experiment 还是 label。同一 metric 可以用一个动态声明展开，也可以用多个显式声明逐值定制：

```tsx
<Line metric={endToEndPassRate} by="agent" />

<Line metric={endToEndPassRate} by="agent" value="baseline" name="baseline" />
<Line
  metric={endToEndPassRate}
  by="agent"
  value="with-memory"
  name="+memory"
  strokeDasharray="4 2"
/>
```

两个形态是互斥的完整 series 集合，不做「一个 `by` 兜底、若干 `value` 再覆盖」的隐式合并；需要共享默认值时用普通 JSX map 或对象展开。`value` 不在 `by` 的 domain、同一 `(组件, by, value)` 重复声明，都以完整用户反馈失败。

`name` 是图例显示名。`dataKey` 定义或选择解析后的 series 身份，不是对象属性路径；动态 `by` 解析成多个 series，因此这种形态不能显式给单个 `dataKey`。spec 形态可以省略 `dataKey`，data 形态必须提供且不能再给数据绑定字段。

### `Line`

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

### `Bar`

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

`colorBy` 解决「行身份是一回事、颜色要表达另一回事」：榜单每行是「agent 线 × 记忆机制」，而颜色要说的是记忆机制。它取的是[页级色映射](README.md#系列色分配单位是页)里 `(该维度, 该柱的维度值)` 的颜色，因此同一个记忆机制在这张图、图例和页上任何按同一维度取色的地方恒同色，深浅主题也跟着走：

```tsx
<BarChart layout="vertical">
  <XAxis metric={endToEndPassRate} orientation="top" />
  <YAxis dimension={["agent", label("memory")]} sort={endToEndPassRate} limit={10} rest="其余" />
  <Bar metric={endToEndPassRate} colorBy={label("memory")}>
    <LabelList position="right" />
  </Bar>
</BarChart>
```

`colorBy` 的维度必须能从每根柱的位置唯一确定取值——它是位置维度本身，或位置维度的一个成员（复合维度的成员），否则一根柱对应多个取值，按完整用户反馈报错并列出冲突的取值。要给具体某个取值指定颜色而不是让它自动分配，用[主题层的钉色](../library/theme.md#钉色)；要单独强调一两根柱而不引入第二个维度，用 `<Cell>`。

### `Area`

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

### `Scatter`

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

`points` 定义点身份，`by` 定义可选的 series 维度。`line` 开启后每个解析后 series 内按 x 原始值升序连线——只给「线 = 同族变体」的 lineage series 用：基线与加了某个机制的变体同线，连线显示位移。散点云之间没有天然顺序，对无关点连线只会画出虚构趋势；表达数值参数的进程用数值 `XAxis` 的折线。

```tsx
<ScatterChart>
  <XAxis metric={costUSD} />
  <YAxis metric={endToEndPassRate} />
  <Scatter points="experiment" by="agent" x={costUSD} y={endToEndPassRate} line />
</ScatterChart>
```

散点直接消费调用方给出的 Scope，不根据 experiment id 隐式分区。

## 嵌套节点

| 节点 | 合法直接父节点 | 作用域 |
|---|---|---|
| `ErrorBar` | `Line` / `Bar` / `Scatter` | 只作用于父 series |
| `LabelList` | `Line` / `Bar` / `Area` / `Scatter` | 父 series 的每个图形项 |
| `Cell` | `Bar` / `Scatter` | 父 series 中匹配的一个或一组图形项 |
| `Label` | `XAxis` / `YAxis` / `ReferenceLine` / `ReferenceArea` / `ReferenceDot` | 父节点自己的标签 |

### `ErrorBar`

```ts
interface ErrorBarProps {
  kind?: "ci95" | "stderr";
  direction?: "x" | "y";
  stroke?: string;
  strokeWidth?: number;
}
```

`kind` 默认 `ci95`。`Line` / `Bar` 根据父 series 的 Metric 轴推定方向（常规布局是 y，横向 Bar 是 x）；`Scatter` 必须显式选择 x 或 y，需要双轴误差时声明两个 `ErrorBar`。区间由父 series 对应 `MetricCell.samples` 计算，不收裸字段路径。

```tsx
<Bar metric={endToEndPassRate}>
  <ErrorBar kind="ci95" />
</Bar>
```

### `LabelList`

`LabelList` 用 `position`、`formatter` 与 `content` 定制，默认值来自父 series 的 `MetricCell`。`value="stackTotal"` 只允许放在带 `stackId` 的 `Bar` / `Area` 下，表示同一 x 上该堆的可加总值。text 面把同一标签作为数值或图例附注输出。

### `Cell`

```ts
interface CellProps {
  value: string;
  dimension?: DimensionInput;
  fill?: string;
  stroke?: string;
  emphasis?: boolean;
}
```

`dimension` 省略时取父 `Bar` 的位置维度或父 `Scatter` 的 `points` 维度；无法唯一推定时要求显式给出。`value` 只在已知父数据边界内匹配图形项，不承担 series 取数。

### `Label`

`Label` 是轴或参考标注的标签子节点，支持 `value`、`position`、`offset` 与 `content`。父 props 的短写 `label="…"` 与单个 `<Label value="…" />` 等价，两者同时给出时报错。

## 图表直接子节点

`CartesianGrid`、`Tooltip`、`Legend`、`ReferenceLine`、`ReferenceArea` 与 `ReferenceDot` 是所有容器的直接子节点。

- `CartesianGrid`：web 面网格；text 面无字符投影。
- `Tooltip`：web 面悬停显示轴值、Metric 显示值与证据；text 面把同一证据放进图例 / 明细摘要，不存在悬停交互。
- `Legend`：两面使用同一已解析 series 顺序与 `name`，可用 `content` 定制。
- `ReferenceLine`：用 `x` 或 `y` + 对应 axis id 定位。
- `ReferenceArea`：用 `x1` / `x2` 或 `y1` / `y2` + axis id 定位。
- `ReferenceDot`：用 `x` / `y` + 两个 axis id 定位。

参考标注在 web 面画进坐标系；text 面以 label、坐标和值域列入图例区。没有 label 时仍输出机器可辨的默认说明。

## 计算规格

JSX 结构树与手工计算形态归一到同一个可序列化规格。呈现字段不属于这些类型：

```ts
type AxisId = string | number;

type XAxisSpec =
  | { xAxisId?: AxisId; dimension: DimensionInput; sort?: Metric; numeric?: never; metric?: never }
  | { xAxisId?: AxisId; numeric: NumericAxis; dimension?: never; metric?: never }
  | { xAxisId?: AxisId; metric: Metric; dimension?: never; numeric?: never };

type YAxisSpec =
  | { yAxisId?: AxisId; dimension: DimensionInput; sort?: Metric; metric?: never }
  | { yAxisId?: AxisId; metric: Metric; dimension?: never; sort?: never };

type MetricSeriesSpec = {
  dataKey?: string;
  metric: Metric;
  by?: DimensionInput;
  value?: string;
  xAxisId?: AxisId;
  yAxisId?: AxisId;
};

type ScatterSeriesSpec = {
  dataKey?: string;
  points: DimensionInput;
  x: Metric;
  y: Metric;
  by?: DimensionInput;
  value?: string;
  xAxisId?: AxisId;
  yAxisId?: AxisId;
};

interface ChartSpec {
  evals?: string | readonly string[];
  xAxes: readonly XAxisSpec[];
  yAxes: readonly YAxisSpec[];
  series: readonly (MetricSeriesSpec | ScatterSeriesSpec)[];
}

function chartData(input: ReportInput, spec: ChartSpec): Promise<ChartData>;
```

`dataKey` 是解析后 series 的稳定身份。省略时由绑定种类、Metric key、`by` 维度 / 值与轴 id 确定性生成；显式值在同一 chart 内必须唯一。它让 data 形态可以对某个已计算 series 应用呈现，而不重新取数。

## `ChartData`

排行条形、维度柱线图、数值趋势和散点共用一份真正覆盖 category × series 的数据模型。维度 key 与数值 x 不压成同一个 `string` 字段，排行也不伪造列维度：

```ts
type AxisId = string | number;

type XAxisData =
  | {
      kind: "dimension";
      xAxisId: AxisId;
      dimension: string;
      values: Array<{ key: string; value: string; display: LocalizedText }>;
    }
  | {
      kind: "numeric";
      xAxisId: AxisId;
      key: string;
      label: LocalizedText;
      unit?: string;
      values: Array<{
        key: string;
        value: number | null;
        display: LocalizedText;
      }>;
    }
  | {
      kind: "metric";
      xAxisId: AxisId;
      metric: MetricColumn;
    };

type YAxisData =
  | {
      kind: "dimension";
      yAxisId: AxisId;
      dimension: string;
      values: Array<{ key: string; value: string; display: LocalizedText }>;
    }
  | {
      kind: "metric";
      yAxisId: AxisId;
      metric: MetricColumn;
    };

type ChartSeriesData =
  | {
      kind: "metric";
      dataKey: string;
      metric: MetricColumn;
      byDimension?: string;
      byValue?: string;
      xAxisId: AxisId;
      yAxisId: AxisId;
      /** 引用该 series 唯一的 dimension/numeric 位置轴值。 */
      rows: Array<{ key: string; axisValueKey: string; cell: MetricCell }>;
    }
  | {
      kind: "scatter";
      dataKey: string;
      pointDimension: string;
      byDimension?: string;
      byValue?: string;
      xAxisId: AxisId;
      yAxisId: AxisId;
      x: MetricColumn;
      y: MetricColumn;
      rows: Array<{ key: string; x: MetricCell; y: MetricCell }>;
    };

interface ChartData {
  xAxes: XAxisData[];
  yAxes: YAxisData[];
  series: ChartSeriesData[];
}
```

维度与数值位置轴的原始值、稳定 key 与本地化显示值各有独立字段。metric series 的 `axisValueKey` 必须命中它所绑定的唯一 dimension / numeric 轴值：常规布局是 X 轴，横向 Bar 是 Y 轴，另一个轴必须是兼容的 Metric 轴。scatter 的 x / y 直接携带 `MetricCell`，因为两轴都需要样本和证据。`Line`、`Bar` 与 `Area` 是同一份 metric series 数据的三种呈现，不写入 Data；`stackId`、颜色、线型、标签和误差口径也留在结构树中。

纵向排行是 dimension X 轴 + Metric Y 轴，横向排行是 Metric X 轴 + dimension Y 轴；维度轴的 `sort` 在聚合后稳定排列 axis values，同值以 key 收口。

## spec / data 两种形态

spec 形态由容器的 `input` 与带数据绑定的结构子节点计算 `ChartData`。data 形态接收 `data={ChartData}`，不再取数：

- `XAxis` / `YAxis` 只用 id 选择已有轴并追加呈现。
- `Line` / `Bar` / `Area` / `Scatter` 必须用 `dataKey` 选择已有 series；`metric`、`points`、`x`、`y`、`by`、`value` 禁止出现。
- 每个要绘制的 series 必须由一个同 kind 的 series 节点引用——`ChartData` 不记录它应画成 line、bar、area 还是 scatter。没有被引用的数据是调用方主动隐藏的 series，重复引用同一个 `dataKey` 则报错。
- `ErrorBar`、`LabelList`、`Cell`、参考标注等呈现节点在两种形态下相同。
- 同时给 `data` 与 `input` 或任何计算绑定字段时，以完整用户反馈失败。

## 聚合与点身份

每个 series 桶内先按 experiment × eval 使用 Metric 的 `perEval`，再跨 eval 使用 `acrossEvals`；所有 `MetricCell` 保留 `samples` / `refs`。排序、缺失值、轴 domain、`better` 方向与证据顺序只计算一次，两面共用。

**数值轴上一个点 = 一个 `(series, x)` 组合。** 落进同一桶的全部 attempt 先在各自 experiment × eval 内用 y 指标的 `perEval` 聚合，再用 `acrossEvals` 跨题折成该点唯一的 y 值——聚合顺序是 `(series, x, experiment, eval)`，同一桶里有多个 experiment 时它们合成一个点，不画垂直来回线。前提是 x 在同一 experiment × eval 内恒定：`numericFlag()` / `numericRunConfig()` 读 experiment 级配置，天然满足；自定义 `NumericAxis.of()` 若对同一 experiment × eval 的不同 attempt 返回不同值，计算以完整用户反馈失败——逐 attempt 变化的量是 y 指标的素材，不是参数轴。`x.of()` 返回 `null` 的 attempt 不伪造 x 值，组件报告未绘制数量。

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时显示明确空态；只有一个可画点时照常画出。

## 两面投影

text 面是字符坐标图，web 面是 SVG，两面同一份数据与同一套顺序规则。

- 点用标记字母 `A`、`B`、`C`… 标识，分配顺序即图例顺序：series 按显示键字典序，series 内按 x 原始值升序，无 series 维度时全部点按点维度键字典序。
- 图例一行一个 series，行首是 series 显示名，后接该 series 各点的标记与 id；图表标题行尾显示归类维度（`· 按 line 归类`）。
- `line` 开启时，图例把 series 内各点以 ` → ` 串联（顺序同 x 升序），并为每段相邻点在下一行给出**位移摘要**——两轴指标的带符号差值（`通过率 +37.5pt · 成本 +$0.13`，`%` 的差是百分点、单位写 `pt`）。text 面不在坐标图里画折线，位移摘要就是线的 text 投影；单点 series 无箭头无摘要。
- web 面每个点都有直接标签。点维度是 experiment 时，只有在当前 data 中末段唯一才缩成末段；重名时使用能区分它们的最短路径后缀，完整 id 与两轴值仍进 tooltip。标签布局保证不静默丢标签，冲突时用 leader line 连回原点。这份最短唯一后缀算法与 [`ExperimentList`](entity-lists.md#experimentlist) 行标签共用同一份实现，同一个 experiment id 在图和列表里缩成同一个显示名。
- series 颜色来自[页级色分配](README.md#系列色分配单位是页)，与同页实体列表里的同名键恒同色。

web 渲染回调属于呈现，可以故意改变可见内容；默认 text 投影仍读取原始 `ChartData`，只有作者提供 `{ web, text }` 双面定制时才替换 text 内容。

## 相关阅读

- [组件树](README.md) —— 结构节点规则、子节点资格总表与共用呈现 props。
- [Gallery](gallery.md) —— 四张真实报告图在本契约下的写法。
- [表格与矩阵](tables.md) —— 同一份指标的非图形投影。
- [指标与维度](../library/metrics.md) —— Metric、Dimension 与 NumericAxis。
- [References · Recharts](../../../references.md#recharts) —— 组件词汇的外部参考。
</content>
