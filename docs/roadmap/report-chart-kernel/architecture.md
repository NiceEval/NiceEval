# Chart 语义内核与报告交互控制器 —— Architecture

## 所有权

图表编译与投影链的值各有一个 owner。

| 值 | owner | 可以包含 | 不得包含 |
|---|---|---|---|
| `ChartModel` | `compileChart` | typed value、MetricValue、缺失、refs、逻辑身份、LocalizedText、ReportTarget | locale 字符串、像素、theme、slot、tick、href、DOM |
| `ChartProjectionOptions` | `compileChart` | size policy、layout、legend、tooltip、grid、locale override、className | typed value、refs、像素、最终 href |
| `ChartProjectionFacts` | `projectChartFacts` | 本地化 display、逐 channel refs/coverage、原 ReportTarget | 像素、theme、visual slot、最终 href |
| `TextProjection` | `projectChartText` | 本地化字符串、终端目标、精确值 rows、字符布局 | web href、CSS、像素、增强状态 |
| `WebScene` | `projectChartWeb` | 像素几何、tick、theme style、visual slot、已求值 href | source row、聚合函数、浏览器状态 |
| `ExactValueRows` | `projectChartWeb` | 所有 channel 的精确值、missing、coverage、refs、可服务链接 | tooltip 状态、像素命中逻辑 |
| `EnhancementPayload` | `projectChartWeb` | point key、focus 顺序、几何、tooltip rows、exact row key、href | source row、MetricValue、refs object、计算函数 |

`compileChart` 的签名只有作者 props，返回 `{ model, projection }`。
它没有 `TextContext`、`WebContext`、theme 或页级 visual keyset。
它可以调用作者提供的纯 `pointTarget(row)`，因为返回值仍是宿主无关的 `ReportTarget`。

## 公开 closed-mark DSL

以下类型表达目标作者表面。
字段键通过泛型收窄；这里用 `string` 展示运行时形状。

```ts
type ChartMark = "line" | "bar" | "area" | "scatter";
type ExternalScalar = string | number | boolean | null;
type ExternalPoint = Readonly<Record<string, ExternalScalar>>;

interface ChartAxisDeclaration {
  id: string;
  channel: "x" | "y";
  position?: "start" | "end";
  scale?: "linear" | "band";
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  bounds?: readonly [number | undefined, number | undefined];
  label?: LocalizedText;
}

interface ChartProps<Row extends object> {
  points?: readonly Row[];
  label: LocalizedText;
  description?: LocalizedText;
  axes?: readonly ChartAxisDeclaration[];
  children: ReportNode;
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout?: "horizontal" | "vertical";
  legend?: boolean;
  tooltip?: boolean;
  grid?: boolean;
  series?: Readonly<Record<string, ChartSeriesOverride>>;
  locale?: ReportLocale;
  className?: string;
}

interface SeriesCommon<Row extends object> {
  id: string;
  mark: ChartMark;
  points?: readonly Row[];
  x: keyof Row & string;
  y: keyof Row & string;
  point?: keyof Row & string;
  by?: keyof Row & string;
  value?: string;
  xAxis?: string;
  yAxis?: string;
  stack?: string;
  connect?: boolean;
  connectNulls?: boolean;
  hidden?: boolean;
  label?: LocalizedText;
  line?: "solid" | "dashed" | "dotted";
  shape?: "circle" | "square" | "diamond";
}

interface EvidenceSeriesProps<Row extends EvidenceRow>
  extends SeriesCommon<Row> {
  external?: false;
  pointTarget?: (row: Row) => ReportTarget | undefined;
}

interface ExternalSeriesProps<Row extends ExternalPoint>
  extends SeriesCommon<Row> {
  external: true;
  pointTarget?: never;
}

type SeriesProps<Row extends object> =
  | EvidenceSeriesProps<Row & EvidenceRow>
  | ExternalSeriesProps<Row & ExternalPoint>;

interface ChartSeriesOverride {
  hidden?: boolean;
  label?: LocalizedText;
  line?: "solid" | "dashed" | "dotted";
  shape?: "circle" | "square" | "diamond";
}

interface ChartProjectionOptions {
  width?: number | `${number}%`;
  height?: number;
  aspect?: number;
  layout: "horizontal" | "vertical";
  legend: boolean;
  tooltip: boolean;
  grid: boolean;
  locale?: ReportLocale;
  className?: string;
}

interface ChartCompilation {
  model: ChartModel;
  projection: ChartProjectionOptions;
}

declare function compileChart<Row extends object>(
  props: ChartProps<Row>,
): ChartCompilation;
```

`compileChart` 为 layout、legend、tooltip 与 grid 填入默认值，但不把 width 或 height 换成像素。
`projection.locale` 是作者可选的 locale override，不是已经本地化的字符串。

web 宿主提供 `availableWidth`。
最终 width 按以下唯一顺序计算：数值 width、百分比 width 乘 availableWidth、availableWidth。

最终 height 按以下顺序计算：数值 height、`width / aspect`、`width / 1.9`。
width、height、aspect 或 availableWidth 不是正有限数时立即失败。

静态导出宿主必须给出确定的 availableWidth。
浏览宿主可以从已知内容栏 policy 提供它，但 projector 不读取 DOM 尺寸。

一个 `Series` 没有 `points` 时继承 `Chart.points`。
两处都没有 rows、字段不存在、point key 重复或一个 Chart 没有 series 时，定义求值立即失败。

没有 `axes` 时，compiler 建立 `x` 与 `y` 两个隐式 axis。
所有可见 series 在同一隐式 axis 上必须有兼容的 value kind 与 unit，否则要求作者声明具名 axis。

series 使用 `xAxis` 或 `yAxis` 时，对应 id 必须存在且 channel 方向一致。
一个具名 axis 上的 series 仍需 value kind 与 unit 兼容；不能用两个刻度格式掩盖单位冲突。

Evidence-only 数值 axis 可以从全部 MetricValue 推定一致的 unit、effective format、better 与 bounds。
有任何冲突时立即失败；显式 axis metadata 也必须与每个 MetricValue 的有效语义兼容。

External-only 数值 axis 在没有声明时使用 unitless `format: "number"`，不猜 better 或 bounds。
Evidence 与未包装的 external scalar 共轴时必须声明具名 axis，并显式提供 `format`；省略 `unit` 明确表示 unitless。

external scalar 由 axis metadata 格式化，但不会获得 samples、total、coverage 或 refs。
category axis 不要求 unit 或 format。

`Series.value` 只在 `by` 存在时选择一个分组值。
它不声明读数、unit、format、better 或 bounds，也不进入 point channel。

`Chart.series[id]` 在 child 声明后应用，只能改变 `hidden`、`label`、`line` 与 `shape`。
未知 id 失败；override 不能改 rows、字段、证据模式、axis、stack 或 point target。

`tooltip={false}` 关闭浮层与增强后的状态区，不删除 SVG 名称、精确值表、focus marker 或可服务链接。
`legend={false}` 只隐藏视觉图例；精确值表仍保留 series 列与完整名称。

## `ChartModel`

`ChartModel` 是 locale-neutral 的普通只读值，不从模块边界公开。

```ts
type ChartScalar = string | number | boolean;
type ChartChannel = "x" | "y" | "point" | "series";

type ChartChannelValue =
  | {
      state: "value";
      scalar: ChartScalar;
      metric?: MetricValue;
    }
  | {
      state: "missing";
      reason: string;
      metric?: MetricValue;
    };

interface VisualIdentityToken {
  dimension: string;
  value: string;
}

type ChartSemanticExtent =
  | {
      kind: "numeric";
      values: "present";
      min: number;
      max: number;
      bounds?: readonly [number | undefined, number | undefined];
    }
  | {
      kind: "numeric";
      values: "empty";
      bounds?: readonly [number | undefined, number | undefined];
    }
  | {
      kind: "category";
      values: readonly ChartScalar[];
    };

interface ChartPointIdentity {
  kind: "field" | "key" | "index";
  value: ChartScalar;
}

interface ChartAxisModel {
  key: string;
  channel: "x" | "y";
  position: "start" | "end";
  scale: "linear" | "band";
  label?: LocalizedText;
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  semanticExtent: ChartSemanticExtent;
}

interface ChartPointModel {
  key: string;
  rowKey: string;
  identity: ChartPointIdentity;
  declarationIndex: number;
  channels: Readonly<Record<ChartChannel, ChartChannelValue | undefined>>;
  rowRefs: readonly AttemptLocator[];
  target?: ReportTarget;
  visualIdentity?: VisualIdentityToken;
  drawable: boolean;
}

interface ChartSeriesModel {
  key: string;
  mark: ChartMark;
  declarationIndex: number;
  sourceKind: "evidence" | "external";
  xAxisKey: string;
  yAxisKey: string;
  stack?: string;
  connect: boolean;
  connectNulls: boolean;
  hidden: boolean;
  label?: LocalizedText;
  line: "solid" | "dashed" | "dotted";
  shape: "circle" | "square" | "diamond";
  visualIdentity?: VisualIdentityToken;
  points: readonly ChartPointModel[];
}

interface ChartMissingSummary {
  seriesKey: string;
  channel: ChartChannel;
  reason: string;
  pointKeys: readonly string[];
}

interface ChartModel {
  key: string;
  label: LocalizedText;
  description?: LocalizedText;
  axes: readonly ChartAxisModel[];
  series: readonly ChartSeriesModel[];
  missing: readonly ChartMissingSummary[];
}
```

row identity 按唯一顺序选择：显式 `point` 字段、非空 scalar `row.key`、series 内的声明 index。
index fallback 只承诺在相同静态 rows 顺序下稳定；需要跨重排保持身份的作者必须声明 `point`。

point key 对 series id、identity kind 与 identity value 做带长度的无歧义编码，不是字符串直接拼接。
compiler 验证全图唯一；重排、exact row、focus、tooltip 与链接都使用这个 key。

EvidenceRow series 要求每行有 `refs`，x/y 读数字段要求 `MetricValue`。
每个 channel 保存自己的 MetricValue，因此 x 与 y 的 coverage 和 refs 不会被合并成第一组证据。

默认 point target 只在 `rowRefs` 恰好含一个 locator 时生成 attempt target。
作者的 `pointTarget(row)` 可以改写它；compiler 保存函数返回的 `ReportTarget`，不保存函数或 source row。

External series 只允许 JSON scalar。
它的 `rowRefs` 恒为空、target 始终省略，也不能借另一个 evidence series 的 point key 获得下钻。

缺失 row 仍生成 `ChartPointModel`，`drawable` 为 false，并进入 exact-value rows。
线段是否跨过缺失点只由 `connectNulls` 决定，不能把 missing 改成零。

hidden series 保留在模型中，便于相同定义稳定验收，但不进入初始 axis extent、scene 或 exact-value rows。
hidden 是作者声明或 override，不是浏览器可切换状态。

stack 先在语义值上形成正负累计 extent。
模型最多保存这个 semantic extent 和作者 bounds；像素 padding、tick 数量和最终 scale domain 都属于媒介投影。

一个数值 axis 的所有值都 missing 时，extent 使用 `values: "empty"`。
两端 bounds 都存在时，媒介可以用 bounds 建立 domain；否则 web axis 没有 numeric domain 或 tick，也不能补造 `0..1`。

## 页级 `ReportRenderPlan`

page 是 compilation 与视觉身份分配的 owner。

```ts
interface CompiledChartNode {
  nodeKey: string;
  compilation: ChartCompilation;
}

interface ReportRenderPlan {
  page: ResolvedReportPage;
  charts: readonly CompiledChartNode[];
  visualKeyset: VisualKeyset;
}
```

plan 按以下唯一顺序建立：

1. 执行被请求 page render 一次，并求值得到 report tree。
2. 把每个 Chart 或便利组件 node 编译一次，保存 `ChartCompilation`。
3. 收集 ChartModel 与其它组件声明的 `VisualIdentityToken`，形成页级 visual keyset。
4. 页级 allocator 先应用 `dimensionPins`，再为未固定 token 分配 visual slot。
5. text 与 web 从 plan 取得同一 compilation；相同 locale 的 facts 也在 plan 内复用。

token 以 `(dimension, value)` 去重。
pins 只作用于本页 keyset 中出现的值；未知维度或未出现值不占 slot，同一 slot 可以由作者分给多个值。

未固定 token 按既有 `(dimension, value)` 稳定哈希取起点，并在空 slot 上向后探测。
分配与组件或 rows 声明顺序无关；visual keyset 超过 24 个身份时按现有契约失败。

`dimensionPins` 只进入 allocator。
`WebProjectionContext` 只接最终 visual keyset，单个 projector 不能读取 pins 或重新编号。

theme 在 web 投影时把 slot 换成 class、颜色、形状、线型或填充图案。
改变 theme 不执行 page render 或 compile 第二次，也不改变 `ChartModel`。

## `ChartProjectionFacts`

本地化 display 与一致性 oracle 在几何投影前形成。

```ts
interface ChartProjectionFactCell {
  channel: ChartChannel;
  scalar: ChartScalar | null;
  missingReason?: string;
  display: string;
  coverage?: string;
  refs: readonly AttemptLocator[];
}

interface ChartProjectionPointFacts {
  key: string;
  seriesKey: string;
  seriesLabel: string;
  cells: readonly ChartProjectionFactCell[];
  target?: ReportTarget;
}

interface ChartProjectionFacts {
  locale: ReportLocale;
  label: string;
  description?: string;
  seriesOrder: readonly string[];
  points: readonly ChartProjectionPointFacts[];
}

declare function projectChartFacts(
  model: ChartModel,
  locale: ReportLocale,
): ChartProjectionFacts;
```

effective locale 是 `ChartProjectionOptions.locale ?? renderContext.locale`。
同一次页面投影为 text 与 web 建立同 locale facts；Projector 不各自格式化 MetricValue。

每个 cell 保留自己 MetricValue 的 refs 与 coverage。
x 与 y 的 refs 即使不同，也不能先合并成 point 级列表再交给 formatter。

facts 保留原 `ReportTarget`，只存在于服务端 plan。
text target formatter 与 web href 函数分别消费它，浏览器 payload 不接触原 target。

## `TextProjection`

```ts
interface TextValueCell {
  channel: ChartChannel;
  label: string;
  scalar: ChartScalar | null;
  display: string;
  missingReason?: string;
  coverage?: string;
  refs: readonly {
    locator: AttemptLocator;
    label: string;
  }[];
}

interface TextPointProjection {
  key: string;
  series: string;
  cells: readonly TextValueCell[];
  targetText?: string;
}

interface TextProjection {
  label: string;
  description?: string;
  points: readonly TextPointProjection[];
  missingSummary: readonly string[];
  lines: readonly string[];
}

declare function projectChartText(
  model: ChartModel,
  facts: ChartProjectionFacts,
  projection: ChartProjectionOptions,
  ctx: TextContext,
): TextProjection;
```

`projectChartText(model, facts, projection, ctx)` 的 context 只含 locale、终端宽度与 text target/ref formatter。
它复用 facts 的 display、coverage 与 missing，并为字符图选择真实终端布局。

`points` 保存完整精确字符串。
`lines` 可以因宽度换行或把空间关系改成表，但不能删掉 `points` 中的 logical point。

text target formatter 只能表达宿主真实支持的入口。
它消费 `ReportTarget`，不会读取 web href，也不会从 refs 猜另一个目标。

layout 不改变 text 的 point 集合；bar 的 text 形态始终使用可读的横向条。
legend、tooltip、grid 与 className 是 web-only 展示项，text projector 明确忽略它们。

## `WebProjection`

```ts
interface WebProjectionContext {
  locale: ReportLocale;
  size: {
    availableWidth: number;
  };
  theme: ReportTheme;
  visualKeyset: VisualKeyset;
  href(target: ReportTarget): string | undefined;
}

interface WebProjection {
  scene: WebScene;
  exactValues: ExactValueRows;
  enhancement: EnhancementPayload;
}

declare function projectChartWeb(
  model: ChartModel,
  facts: ChartProjectionFacts,
  projection: ChartProjectionOptions,
  ctx: WebProjectionContext,
): WebProjection;
```

静态导出必须传入确定的像素尺寸。
百分比宽度在导出前由宿主的 size policy 换成像素；`projectChartWeb` 不测量 DOM。

layout 选择 bar 的横向或纵向几何；legend 与 grid 决定对应 scene node 是否存在。
className 只附加到 chart root，不能改变 key、domain 或 display。

tooltip 决定 payload 是否带 tooltip rows，以及 controller 是否显示浮层和状态区。
即使 tooltip 为 false，payload 仍保留 focus order、exact row key 与 href，键盘导航和精确值表继续工作。

同一次 web 投影从 facts 取得 display cells，再生成可服务 href，并让三个输出复用。
SVG、精确值表和 payload 不得分别格式化 MetricValue、选择默认 target 或分配 visual slot。

### `WebScene`

```ts
interface ScenePoint {
  pointKey: string;
  x: number;
  y: number;
  nodeKey: string;
}

type SceneGeometry =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "polyline"; points: readonly [number, number][] }
  | { kind: "area"; path: string }
  | { kind: "text"; x: number; y: number; text: string };

interface WebSceneNode {
  key: string;
  role: "mark" | "axis" | "grid" | "legend" | "label" | "focus";
  geometry: SceneGeometry;
  className: string;
  pointKeys: readonly string[];
  href?: string;
}

interface WebAxisScene {
  key: string;
  domain?: readonly ChartScalar[];
  ticks: readonly {
    value: ChartScalar;
    position: number;
    label: string;
  }[];
}

interface WebScene {
  key: string;
  width: number;
  height: number;
  plot: { x: number; y: number; width: number; height: number };
  label: string;
  description?: string;
  axes: readonly WebAxisScene[];
  nodes: readonly WebSceneNode[];
  points: readonly ScenePoint[];
}
```

`WebAxisScene.domain` 是加入像素 padding 和 tick policy 后的最终 scale domain。
它只存在于 web scene；text 根据终端宽度选择自己的 tick 与字符坐标。

empty numeric extent 没有完整 bounds 时，`domain` 省略且 ticks 为空。
scene 仍显示 axis label、missing 摘要和 exact-value table。

theme、visual keyset 与 dimensionPins 共同选择 class、颜色、形状、线型或填充图案。
scene 保存已求值样式的 class，不把视觉槽位写回 `ChartModel`。

href 只由 `WebProjectionContext.href()` 产生。
函数返回 `undefined` 时，scene 与精确值表都不生成链接，payload 也不携带 href。

### `ExactValueRows`

```ts
interface ExactValueLink {
  label: string;
  href: string;
}

interface ExactValueCell {
  channel: ChartChannel;
  label: string;
  scalar: ChartScalar | null;
  display: string;
  missingReason?: string;
  coverage?: string;
  refs: readonly {
    locator: AttemptLocator;
    label: string;
    href?: string;
  }[];
}

interface ExactValueRow {
  key: string;
  series: string;
  cells: readonly ExactValueCell[];
  target?: ExactValueLink;
}

interface ExactValueRows {
  label: string;
  description?: string;
  columns: readonly {
    key: ChartChannel | "series" | "target";
    label: string;
  }[];
  rows: readonly ExactValueRow[];
}
```

每个非 hidden `ChartPointModel` 恰好对应一个 `ExactValueRow`，包括 `drawable: false` 的 missing point。
每个已声明 channel 恰好对应一个 cell；没有值时写 missing reason，不能留成无法区分的空格。

MetricValue 的 coverage 与 refs 留在自己的 channel cell。
row-level target 与每条 ref 分开；宿主可服务时生成 href，不可服务时仍显示 locator label。

web renderer 把 `ExactValueRows` 写成 SVG 同级的原生 `<details>` 与 `<table>`。
表头、series、完整 scalar 字符串、missing、coverage 和证据入口不依赖 JavaScript。

### `EnhancementPayload`

```ts
interface EnhancementTooltipRow {
  label: string;
  display: string;
}

interface EnhancementPoint {
  key: string;
  exactRowKey: string;
  order: number;
  x: number;
  y: number;
  groupKey?: string;
  tooltip: readonly EnhancementTooltipRow[];
  href?: string;
}

interface EnhancementPayload {
  schema: "niceeval.chart-enhancement/1";
  chartKey: string;
  label: string;
  points: readonly EnhancementPoint[];
}
```

payload 只列 drawable point。
每项必须能用 `key` 找到 scene point，用 `exactRowKey` 找到精确值 row。

tooltip rows 与 exact-value cells 使用同一次格式化结果。
payload 可以选择较少的行，但不能改写 display 字符串或 missing 意义。

payload 不嵌入 source row、MetricValue、AttemptLocator、ReportTarget、theme object 或格式化函数。
服务端已经把允许导航的 target 换成最终 href；controller 不再接触报告路由协议。

## Chart controller

controller 以 chart root 与 `EnhancementPayload` 初始化，不执行 React hydration。
初始 SVG 与 exact table 已经完整，脚本失败不会移除内容或证据入口。

controller 只拥有：

```ts
interface ChartViewState {
  focusedPointKey?: string;
  pinnedPointKey?: string;
  input: "pointer" | "keyboard";
}
```

图表根是一个 tab stop。
方向键按 `order` 和 scene 几何选择相邻 point；Pointer 命中写入同一个 `focusedPointKey`。

Enter 只在当前 point 有 href 时导航。
Escape 清除 pinned point；离开图表时清除临时 pointer focus，但保留原生链接能力。

focus marker、结构化 tooltip 和 `aria-live` 状态区都从当前 key 查 payload。
controller 不读取 `<title>`、path d、DOM 顺序或 SVG 文本来猜 point 值。

## Table controller

Table 的权威语义输入仍是 `TableContent`。
公开 API 同时接受 flat rows 和同构 nested rows：

```ts
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type StringKeyOfUnion<T> = Extract<KeysOfUnion<T>, string>;
type ValueAt<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : undefined
  : never;
type IsAny<T> = 0 extends 1 & T ? true : false;
type PresentAt<T, K extends PropertyKey> = Exclude<
  ValueAt<T, K>,
  null | undefined
>;

type ValidSubRowsKey<
  Row extends object,
  K extends StringKeyOfUnion<Row>,
> = IsAny<PresentAt<Row, K>> extends true
  ? never
  : [PresentAt<Row, K>] extends [never]
    ? never
    : [PresentAt<Row, K>] extends [readonly Row[]]
      ? K
      : never;

type TableSubRowsKey<Row extends object> = {
  [K in StringKeyOfUnion<Row>]: ValidSubRowsKey<Row, K>;
}[StringKeyOfUnion<Row>];

type TableStringKey<Row> = Extract<keyof Row, string>;
type TableVisibleKey<
  Row,
  Excluded extends PropertyKey = never,
> = Exclude<TableStringKey<Row>, Extract<Excluded, string>>;
type TableSortToken = string | number | boolean | null;

type TableSearch =
  | true
  | {
      label?: LocalizedText;
      placeholder?: LocalizedText;
    };

type TableSort<Row, Excluded extends PropertyKey = never> =
  | true
  | {
      field: TableVisibleKey<Row, Excluded>;
      direction: "asc" | "desc";
    };

type TableColumnDefinition<
  Row extends object,
  Excluded extends PropertyKey = never,
> = {
  [K in TableVisibleKey<Row, Excluded>]: {
    field: K;
    header?: LocalizedText;
    searchable?: boolean;
  } & (
    | {
        sortable?: true;
        sortValue?: (
          value: Exclude<Row[K], null | undefined>,
        ) => TableSortToken;
      }
    | {
        sortable: false;
        sortValue?: never;
      }
  );
}[TableVisibleKey<Row, Excluded>];

type TableColumn<
  Row extends object,
  Excluded extends PropertyKey = never,
> =
  | TableVisibleKey<Row, Excluded>
  | TableColumnDefinition<Row, Excluded>;

interface TablePresentationProps {
  locale?: ReportLocale;
  className?: string;
}

interface FlatTableProps<Row extends object>
  extends TablePresentationProps {
  rows: readonly Row[];
  columns?: readonly TableColumn<Row>[];
  subRows?: never;
  search?: TableSearch;
  sort?: TableSort<Row>;
}

interface NestedTableProps<
  Row extends object,
  K extends TableSubRowsKey<Row>,
> extends TablePresentationProps {
  rows: readonly Row[];
  columns?: readonly TableColumn<Row, K>[];
  subRows: K;
  search?: TableSearch;
  sort?: TableSort<Row, K>;
}

interface TableRuntimeProps extends TablePresentationProps {
  rows: readonly object[];
  columns?: readonly unknown[];
  subRows?: string;
  search?: TableSearch;
  sort?: true | {
    field: string;
    direction: "asc" | "desc";
  };
}

type TableComponentBase = Pick<
  ReportComponent<TableRuntimeProps>,
  typeof COMPONENT_FACES | "displayName"
>;

type TableComponent = TableComponentBase & {
  <Row extends object, K extends TableSubRowsKey<Row>>(
    props: NestedTableProps<Row, K>,
  ): ReactNode;
  <Row extends object>(props: FlatTableProps<Row>): ReactNode;
};

export const Table = TableImplementation as unknown as TableComponent;
```

`TableSubRowsKey` 对 union 分支逐一读取字段，再要求所有 present value 都是 `readonly Row[]`。
它接受自然的 branch/leaf discriminated union 与 optional recursive field，拒绝 scalar、`any`、`readonly object[]` 和含 null child 的数组。
Nested overload 必须排在 flat overload 前，且 flat props 用 `subRows?: never` 关闭逃逸路径。

`TableVisibleKey<Row, K>` 只保留所有 union 分支共有的 string key，并排除 child field。
因此 `subRows` 不能同时出现在 columns 或 sort 中，variant-only field 也不能伪装成所有层级共有的可见列。
`ReportComponent<TableRuntimeProps>` 的宽调用签名不能和泛型 overload 相交；`TableComponentBase` 只保留 faces metadata 与 displayName。

mapped discriminated union 让 `field: K` 对应的 `sortValue` 参数精确为 `Row[K]`，不是所有字段值的 union。
shorthand 与复杂列都只接受可见 string key。

`subRows` 是字段选择器，不是 `getSubRows(row)` callback。
它只表达所有层级共享同一组可见 columns 的树，并直接规范化为现有 `TableContent.subRows`；不增加 `NestedTableModel`。
不同 schema 的子表、任意 detail panel 与 renderer callback 不属于 Table primitive，作者使用 `Section`、另一只 `Table` 或同时定义 text/web 的组合组件。

显式 `columns` 定义全部可见列；省略 columns 时按第一行的稳定字段顺序推导。
Nested Table 自动推导时排除 `subRows`，并递归要求每个 row 的其余字段集合与第一个 root row 完全相同。
不相同时错误给出结构路径并要求作者传显式 columns。

显式 columns 可以忽略 variant-only extra fields，但每个 selected field 必须出现在每个 row。
列重复、selected field absent 或值为 `undefined` 都在装载时失败，并指出 column field 与 `rows[0].children[2]` 形态的结构路径。

`header` 只产生 text 表头与 web `<th>` 的本地化名称。
column identity、sort 地址和 payload key 始终使用 `field`，不从 header 文本反推。

顶层 `search` 存在时才产生 query state、search token 与搜索控件。
顶层 `sort` 存在时才产生 sort state、sort rank 与可排序表头。
列级 `searchable`、`sortable` 或 `sortValue` 没有对应顶层能力时是死配置，装载必须拒绝而非忽略。

`sort={true}` 的首屏 state 没有 sort，行保持声明顺序。
对象形态把 `field` 与 `direction` 编入 initial state；field 不存在或 `sortable: false` 时装载失败。

`search` 的 initial query 固定为空。
它只匹配 effective locale 下由同一 Cell formatter 产生的用户可读文本，不匹配 field、header、href、隐藏 refs、其它 locale 或别名。

`sortValue` 是 build-time-only 的纯 token projection，不接收整行。
字段值为 `null` 时 callback 不执行并产生 missing；MetricValue 对象存在时 callback 可以读取整个对象。

没有 `sortValue` 时，string、number、boolean 与 LocalizedText 使用内建 projection。
MetricValue 使用自己的 `value`；其 value 为 null 时产生 missing rank。

同一 column 的非 null token 必须都是同一种 primitive；number 必须 finite。
boolean 按 false、true 排序，number 按数值排序，string 使用 effective locale 与固定 `Intl.Collator` options 排序。

collator options 是 `{ usage: "sort", sensitivity: "base", numeric: true, ignorePunctuation: false }`。
原 token 只在 page plan 中存在；编译器把升序结果固化成 numeric rank，相等 token 取得同一 rank。

函数与原 token 都不进入浏览器 payload。
null 或 missing rank 在升序和降序中始终位于末尾；相等 rank 始终按各 sibling set 的声明顺序保持稳定。

`sortValue` 不能改变显示 Cell、MetricValue、coverage、refs 或 field identity。
跨字段排序或计算列先在 page 中用普通函数产生显式字段。

public Table 不提供 `features`、`initialState`、`rowKey`、`expanded`、multi-sort、`better`、`hidden` 或列级 `label`。
它也不提供通用 accessor、display/group column、renderer callback 或 controlled `state/onStateChange`。

普通 rows 在当前 Table render instance 内按结构 occurrence 得到 opaque key；该 key 不承诺跨 remount、重新装载或构建的 identity。
同一个对象出现在两个 parent 下是两个合法 occurrence，不共享展开状态。
重新装载或 remount 后折叠状态重置为全部展开；public API 不提供持久化、deep link 或 live patch 契约。

Nested rows 的装载校验使用显式 traversal stack，不依赖 JavaScript call stack。
selected child field absent、null、undefined 或空数组表示 leaf；present non-null value 必须是 readonly Row array，其中每个 child 必须是 object。
cycle detector 只检查当前 ancestor stack，因此 ancestor cycle 失败并给出结构路径，共享对象出现在另一个 branch 仍然合法。

组合组件提供的 `TableContentRow.key` 继续承担层级行 identity，不进入普通 rows 作者 API。

web renderer 产生初始 HTML 与以下浏览 payload：

```ts
interface TableEnhancementColumn {
  key: string;
  sortable: boolean;
  header: string;
}

interface TableEnhancementRow {
  key: string;
  parentKey?: string;
  depth: number;
  siblingIndex: number;
  hasChildren: boolean;
  declarationIndex: number;
  sortRanks?: Readonly<Record<string, number | null>>;
  searchToken?: string;
}

interface TableSearchEnhancement {
  label: string;
  placeholder?: string;
}

interface TableSortEnhancement {
  columnKeys: readonly string[];
}

interface TableEnhancementPayload {
  schema: "niceeval.table-enhancement/1";
  columns: readonly TableEnhancementColumn[];
  rows: readonly TableEnhancementRow[];
  search?: TableSearchEnhancement;
  sort?: TableSortEnhancement;
  initial: TableViewState;
}

interface TableViewState {
  query?: string;
  sort?: {
    columnKey: string;
    direction: "ascending" | "descending";
  };
  expandedRowKeys: readonly string[];
}

interface TableView {
  visibleRowKeys: readonly string[];
  orderedRowKeys: readonly string[];
}
```

locale-aware formatter 在服务端生成 `sortRanks` 与 `searchToken`。
按 locale 选出的 header 文案可以进入 payload 的 `header`，但不能充当 column key。
`deriveTableView(payload, state)` 是纯函数。
排序递归作用于每一组 siblings，parent 与 descendants 永远不混排；null 始终在末尾，相同 rank 按 `siblingIndex` 保持声明顺序。

`initialTableViewState(content, props, locale)` 把 Table 的 sort prop 换成 state，并让所有父 row 初始展开。
search 启用时 query 固定为空；search 关闭时 state 中不存在 query slice。
同一次 page plan 只建立一份 payload 与 initial state，text 和 web 都先调用 `deriveTableView`。

text 按 `orderedRowKeys` 与 `visibleRowKeys` 输出；无 JavaScript web 使用相同 DOM 顺序，并把每个层级 row 写成真实 `<tbody>` 内的 `<tr>` 与 `<td>`。
controller 启动时复用 payload.initial，第一次投影不得改变 row 顺序、可见性或 disclosure。

search token 与 query 共用以下函数：

```ts
function normalizeTableSearch(value: string, locale: ReportLocale): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase(locale)
    .trim()
    .replace(/\s+/gu, " ");
}
```

query 规范化后按空格拆成 terms；row 必须让每个 term 都出现在 `searchToken` 中。
空 query 命中所有 row，并服从 underlying `expandedRowKeys`。

非空 query 的结果是直接 matching rows 加上它们的全部 ancestors。
parent 自身匹配不会带出未匹配 descendants；child 匹配会保留 ancestor。
搜索期间结果树只读且视为全部展开，所有 disclosure button 都隐藏，underlying expanded state 不被改写。
清空 query 后恢复搜索前的折叠状态；没有 included child 的 parent 在结果树中是临时 leaf，不显示无效控制。

controller 用 row key 把 `TableView` 投影到已有元素。
它不读取 cell `textContent`、当前 DOM index 或 DOM 展开属性来重建权威状态。

每个可排序 `th` 内含原生 button。
点击或键盘激活更新 `TableViewState.sort`，并把方向写到所属 `th[aria-sort]`。

过滤输入由可见 label 或 `aria-label` 命名。
服务端把层级 disclosure button 放在第一格并保持 hidden，因此无 JavaScript 时没有无效控制且所有 rows 完整可读。
enhancer 启动后显示有 child 的 button，以 `aria-expanded` 暴露状态，点击、Enter 或 Space 只更新 opaque row key 对应的 `expandedRowKeys`。

层级 markup 不使用 `<td colSpan>` 包裹伪表格，也不使用 `<details>` 容纳 rows。
所有层级共享同一组 `<th>`，浏览器的原生 table header/cell association 保持有效。
第一格显示可见缩进，并包含 screen-reader-only 的层级文本。
disclosure button 的可访问名称包含动作与该 row 的第一格文本；不生成 `aria-controls` 或 DOM id，因为行关系已在 payload 中表达，且 [WAI APG Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) 把 `aria-controls` 定义为可选项。

normalizer、row derivation 与 renderer 的层级遍历都使用 iterative algorithm。
深树 fixture 必须证明不会因递归深度抛出 `RangeError`；宽树 fixture 同时报告 HTML 与 payload 的 raw/gzip bytes，并证明 payload 不复制 source row、cell display、MetricValue 或 refs object。

## Table 验收 fixture

普通 rows fixture 同时包含 string、number、boolean、LocalizedText、MetricValue、null 与枚举 status。
两行具有相同排序 token，两行的 token 为 null；枚举列通过纯 `sortValue` 产生 numeric token。

fixture 在 `en` 与 `zh-CN` 下分别编译，并验收：

- `<Table rows={rows} />` 不产生搜索、排序 state 或浏览 payload 字段。
- `sort={true}` 保持声明顺序，对每个可排序表头按 ascending、descending、未排序循环。
- 对象 `sort` 让 text、无 JavaScript web 与 controller 首帧同序，第一次增强零重排。
- null 在两个方向始终位于末尾，相等 rank 始终保持 declaration order。
- 浏览器只比较 numeric rank，不执行 `Intl.Collator` 或作者 `sortValue`。
- search 只命中 effective locale 的可读 cell 文本，不命中 field、header、href、隐藏 refs 或其它 locale。
- query 规范化、直接命中加 ancestors、parent 命中不带 subtree，以及搜索期间隐藏 disclosure 都服从同一 `deriveTableView`。
- nested sort 只递归重排 siblings；相同 rank 保持各 sibling set 内的 declaration order。
- 无 JavaScript hierarchy 使用真实 table rows、显示全部内容且没有可操作的 dead disclosure；增强后按钮支持 Enter、Space 与 `aria-expanded`。
- 清空 query 恢复搜索前的折叠状态，remount 则重置为全部展开。
- search 与 sort 不改变任何 Cell、MetricValue、coverage 或 refs。

类型 fixture 证明 mapped union 会按 `field` 收窄 `sortValue` 参数。
它接受 branch/leaf union 和 optional recursive child field，拒绝 scalar/`any`/含 null child 的 `subRows`，并拒绝把 child field 或 variant-only field用于 columns 与 sort。
它也拒绝 symbol/number key、`sortable: false` 与 `sortValue` 并用，以及旧 `label`、`hidden`、`searchable` 顶层 prop 和字符串 `sort`。

装载错误 fixture 逐项验证重复 field、absent/undefined selected field、自动列 shape mismatch、非法 child、ancestor cycle、死配置、不可排序的首屏 field、混合 token 类型和非有限 number。
共享对象 fixture 证明不同 parent 下的 occurrence 拥有不同 opaque key；深树与宽树 fixture 验证 stack safety 和输出体积。
spy 证明每个 present 值的 `sortValue` 只执行一次；函数与原 token 不出现在序列化 payload。

## 双面不变量

测试从 text points 与 web exact rows 提取逐 channel comparison record：

```ts
interface ChartConsistencyRecord {
  pointKeys: readonly string[];
  seriesOrder: readonly string[];
  cells: readonly {
    pointKey: string;
    channel: ChartChannel;
    scalar: ChartScalar | null;
    missingReason?: string;
    display: string;
    coverage?: string;
    refs: readonly AttemptLocator[];
  }[];
}
```

相同 locale 的 `TextProjection` 与 `WebProjection.exactValues` 必须还原成相同 record。
这个 record 还必须逐字段等于输入 `ChartProjectionFacts`，不能把 x/y refs 合并成 point refs。

测试用 spy 替代 text target formatter 与 web href 函数。
每个 facts target 必须各传给两个 spy 一次，参数 deep-equal 原 `ReportTarget`；测试不从目标字符串或 href 反推 target。

比较不包含 tick、像素、换行、颜色、shape、class、href 文本或 tooltip 是否打开。

WebScene、ExactValueRows 与 EnhancementPayload 另有 key 完整性检查：

- 每个 drawable、非 hidden point 在 scene 与 payload 中各出现一次。
- 每个非 hidden point 在 exact rows 中出现一次，missing 也不例外。
- payload 的每个 `exactRowKey` 与 scene `pointKey` 都存在。
- serviceable target 的 href 在 scene、exact row 与 payload 中相同。
- theme、dimensionPins 或尺寸变化不能改变 comparison record。

## 垂直验收 fixture

固定 fixture 包含三种 series 与 72 个 logical point：

- Evidence scatter：24 行，x/y 都是 MetricValue，含单 refs、多 refs、coverage 与 missing。
- Evidence line：24 行，含 `connectNulls: false`、具名右轴和独立 pointTarget。
- External budget line：24 行，使用自带 points、`external: true`，没有 refs 或 target。

Evidence 与 external 共用的 cost/quality axis 都显式声明 unit、format、better 与 bounds。
测试证明 external 的 exact、tooltip 与 tick 服从 axis contract，同时没有 MetricValue 或 coverage。

fixture 分别在 `en`、`zh-CN`、两组 dimensionPins、固定 light/dark theme 与两个导出尺寸下投影。
它同时验收 text、静态 SVG、无 JavaScript 精确值表和启用 controller 后的 pointer/keyboard focus。

测试列出以下字节数：

| 部分 | raw bytes | gzip bytes |
|---|---:|---:|
| SVG | 必填 | 必填 |
| exact-value `<details>` | 必填 | 必填 |
| enhancement payload | 必填 | 必填 |
| 整张 chart HTML | 必填 | 必填 |

72-point fixture 的 exact-value HTML 与 payload 合计上限是 48 KiB raw、12 KiB gzip。
超限先缩减重复 display rows 或 markup，不能删除 exact values、missing、coverage、refs 或键盘信息。

第二个 closed-mark matrix fixture 使用较小的确定 rows：

- 两个 bar series 在 band x axis 上形成正负 stack，分别投影 vertical 与 horizontal layout。
- 两个 area series 在 numeric x axis 上 stack，并包含 missing 与 `connectNulls: false`。
- bar 断言 rect、正负 domain、stack baseline、分类顺序和 text 横向条。
- area 断言 area path、stack extent、missing 断点和 text 精确值关系。
- 每个 drawable point 在 scene 与 payload 各出现一次，每个 missing point 仍进入 exact rows。

72-point fixture 验收 scatter 与 line；matrix fixture 验收 bar 与 area。
两者合起来穷尽 closed mark、band axis、正负 stack 与 horizontal layout。

## `defineRenderer`

`defineRenderer` 继续从 `niceeval/report/extension` 独立导出。
它只承诺已计算普通值、text/web 双面、assets、dimensions 和现有 render context。

内部 Chart 类型不从 `niceeval/report` 或 `niceeval/report/extension` 导出。
自定义 renderer 不能传入 `ChartModel`、调用 web projector、追加 scene node 或注册 Chart mark。

这个边界让 Chart 内核可以在不扩大公共兼容面的前提下演进。
它也诚实说明自定义 heatmap 必须自行提供精确值、键盘行为、证据链接和双面一致性。
