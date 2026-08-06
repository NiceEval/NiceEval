# 格式化与呈现工具箱

同一个读数会出现在三个地方：`show` 的 text 面、`view` 的 web 面、导出的 JSON。
JSON 保留数值与格式元数据，两个展示面必须从这份数据按各自 locale 得到一致读法。
视觉身份同理：图例里的 `codex` 与表里的 `codex` 必须同色。

所以格式化、缺数据文案与视觉编码都只有一个官方入口。
这一页是这些入口的单点清单：[原语与自定义组件](layout.md)讲怎么组织报告树，这里讲组件与数据源内部允许调用什么。

## 公开函数总表

`niceeval/report` 导出下面这些纯函数。
格式化、缺数据、维度呈现与 locale 组同时从 `niceeval/report/react` 导出，自有 React 页面用的是同一批实现；文本排版只在 `niceeval/report`，web 面不按显示列宽对齐。

| 分组 | 导出 | 签名 | 用途 |
|---|---|---|---|
| 格式化 | `formatMetricValue` | `(value: number \| null, unit?: string, format?: MetricFormat, locale?: ReportLocale) => string` | renderer 按当前 locale 把终值折成展示字符串 |
| 格式化 | `formatInstant` | `(iso: string, locale?: ReportLocale) => string` | ISO 时刻按当前 locale 折成人读时间 |
| 格式化 | `formatTimeDistance` | `(ms: number, locale?: ReportLocale) => string` | 一段时长按当前 locale 折成紧凑相对时距 |
| 格式化 | `formatAxisTick` | `(value: number, step: number, unit?: string) => string` | 轴刻度，精度跟随步长 |
| 格式化 | `formatCellText` | `(cell: Cell \| null, locale?: ReportLocale) => string` | 把任意 `Cell` 折成一行文本 |
| 缺数据 | `missingText` | `(code: string, locale?: ReportLocale) => string` | `missing` 格的本地化原因 |
| 维度呈现 | `presentDimension` | `(declaration: DimensionDeclaration<E>) => ResolvedDimension<PresentationFor<E>>` | 页管线之外取标签与视觉编码 |
| 维度呈现 | `shortestUniqueLabels` | `(ids: readonly string[]) => Map<string, string>` | 一组 id 的最短唯一后缀 |
| locale | `DEFAULT_REPORT_LOCALE` | `ReportLocale` | 回退语言（`"en"`） |
| locale | `resolveLocalizedText` | `(text: LocalizedText, locale: ReportLocale) => string` | 按回退链取一种语言 |
| locale | `resolveMetricLabel` | `(label: LocalizedText \| undefined, locale: ReportLocale, fallback: string) => string` | 读数或列名的本地化显示标签 |
| locale | `localizedTextEquals` | `(a: LocalizedText, b: LocalizedText) => boolean` | 两份 `LocalizedText` 逐语言相等 |
| 文本排版 | `stringWidth` | `(text: string) => number` | 显示宽度：CJK / 全角记 2 列，其余 1 列 |
| 文本排版 | `padEnd` | `(text: string, width: number) => string` | 按显示宽度在右侧补齐（左对齐） |
| 文本排版 | `padStart` | `(text: string, width: number) => string` | 按显示宽度在左侧补齐（右对齐，数字列用） |
| 文本排版 | `wrapText` | `(text: string, width: number) => string[]` | 按显示宽度折行 |
| 文本排版 | `indent` | `(block: string, prefix: string) => string` | 每行加缩进 |
| 文本排版 | `bar` | `(ratio: number, width: number) => string` | 字符条：`█` 填充、`░` 补齐到 `width` |
| 文本排版 | `columns` | `(blocks: string[], widths: number[], separator?: string) => string` | 多块并排 |

这张表是完整的：报告面不再公开第二个格式化函数、第二种取色方式或第二把宽度尺。
[不公开的东西](#不公开的东西)逐条说明缺席的那些为什么缺席。

## 格式化只有一个入口

计算层不生成显示字符串。
`MetricValue` 只携带 `value`、`unit` 与 `format` 元数据， renderer 在输出 text 或 web 时调用 `formatMetricValue()`：

```ts
interface MetricValue {
  value: number | null;
  unit?: string;
  format?: MetricFormat;
  samples: number;
  total: number;
  basis: "attempt" | "eval" | "run" | "pair";
  refs: readonly AttemptLocator[];
}
```

- **`value` 是计算终值。**
  `null` 表示这一格没有有效样本；排序、轴与下游计算读它。
- **展示字符串不预生成。**
  两个面各自在 renderer 内调用同一个纯函数，并传入当前 locale。
- **locale 是渲染上下文。**
  内建 unit 格式在各语言下读法相同；`custom` format 可以按 locale 改文案，但不能改变数值或聚合口径。

```ts
const cell = metricValue({ value: mean, unit: "tokens", samples, total, refs });
const display = formatMetricValue(cell.value, cell.unit, cell.format, locale);
// 46500 → "46.5k tokens"
```

**`String(value)` 不是格式化。**
绕过 `formatMetricValue` 写 `String(value)`、`value.toFixed(1)` 或 `` `${value} tokens` `` 会让同一个读数在两处显示不一致。

### unit 决定格式

`unit` 是 Calculation 里的量纲声明，也是格式化的开关：

| `unit` | 折成 | 例子 |
|---|---|---|
| `"%"` | 百分比，一位小数去尾零 | `87.3%` / `100%` |
| `"ms"` | 人读耗时 | `850ms` / `1.2s` / `4m 20s` / `1h 4m` |
| `"$"` | 金额 | `$0.31` |
| 其它（如 `"tokens"`） | 千位缩写加单位 | `46.5k tokens` |
| 省略 | 千位缩写 | `1.2k` / `385.7k` |

千位缩写只在后两支生效。
百分比、耗时与金额各有自己的读法，缩写会把它们读坏。

`MetricFormat` 的 `custom` 分支覆盖内建格式：

```ts
export const cacheHitRate = rollup(
  async (attempt) => …,
  {
    unit: "%",
    format: {
      kind: "custom",
      format: (value, locale) =>
        locale === "zh-CN" ? `命中 ${Math.round(value * 100)}%` : …,
    },
    withinEval: mean,
    acrossEvals: mean,
  },
);
```

它只格式化同一个终值。
覆盖不能改变聚合口径，也不能按 locale 给出不同的数——两份数字会让同一张报告的中英文版本对不上账。

### 时刻不走 unit

时刻不是 `MetricValue`：它没有量纲、不参与聚合、不上轴，所以 `unit` 那张表里没有它的位置。
它的入口是 `formatInstant(iso, locale)`——输入是落盘的 ISO 字符串，输出是当前 locale 的人读时间。

```ts
formatInstant(attempt.result.startedAt, locale);
// 2026-07-29T12:14:31.831Z → "Jul 29, 2026, 20:14"
```

**原样打 ISO 不算格式化。**
`String(iso)`、`iso.slice(0, 16)`、`new Date(iso).toLocaleString()` 三种写法各给出一种读法，同一个时刻在报告的两处对不上，也不跟随 locale。

### 轴刻度是另一支

`formatAxisTick(value, step, unit)` 的精度跟随刻度步长，不跟随值本身：步长 `0.25` 的刻度打 `0.25` / `0.5` / `0.75`，而 `formatMetricValue` 会把它们缩写掉。
自定义图表组件画轴用它，不自己 `toFixed`。

### 显式历史中的相对时距

History、稳定性等显式时间旅途需要显示「这次执行距今多久」时，两面都调用 `formatTimeDistance(ms, locale)`，不各写一套措辞。
当前报告不根据 Attempt 来源追加时距或降饱和；相对时距不是 current 状态字段。

| 区间 | en | zh-CN |
|---|---|---|
| 不足 1 小时 | `45m` | `45 分钟` |
| 不足 1 天 | `6h` | `6 小时` |
| 不足 30 天 | `12d` | `12 天` |
| 30 天及以上 | `4mo` | `4 个月` |

取整到该区间的单位，结果恒不小于一个单位：不足一分钟的时长打 `1m`，不打 `0m` 或秒。
时距紧贴它描述的那个 locator，不加箭头、回环之类的装饰记号——记号不携带时长，读者还要先学会它。

## 缺数据、不适用与占位

三种空格是三件不同的事，各有自己的文案来源，不互相顶替：

| 形态 | 含义 | 文案 |
|---|---|---|
| `metric` 且 `value === null` | 覆盖到了计数单位，但没有一条给得出值 | renderer 经 `formatMetricValue` 取缺数据文案 |
| `missing` | 本该有却没跑到 | `code` 经词表映射 |
| `notApplicable` | 这个读数对这一行没有意义 | `—` |

`missing` 的 `code` 是**结构化代码**，不是显示文本。
内建词表：

| `code` | 含义 | en | zh-CN |
|---|---|---|---|
| `noSamples` | 这一格覆盖的 attempt 读数全部为 `null` | `no data` | `无数据` |
| `neverRun` | 历史中从未出现这道题的物理 Attempt | `not run yet` | `尚未运行` |
| `previousResult` | 有旧但不兼容的结果，当前配置下仍无结果 | `no result for current config` | `当前配置下无结果` |
| `unscorable` | 有 attempt，但读数测不出 | `unscorable` | `测不出` |

`missingText(code, locale)` 是两个面共用的入口，`formatCellText` 的 `missing` 分支调它。
词表未命中时原样返回 `code`，两面都照常显示——自定义数据源的原因不会被静默吞掉。

**把英文文案写进 `code` 会在中文报告里留下一格英文。**
`code` 只进词表，文案只进词典；一格 `no data` 挨着一格「无数据」，读者会以为它们是两种状态。

### `missing` 格的完整形状

一格缺数据除了原因，还可能带下一步和旧结果 locator：

```ts
{
  kind: "missing",
  code: string,
  /** 补上这一格的命令，可直接复制。 */
  detail?: string,
  /** Sample 已确认存在旧结果时提供的审计与显式 accept 入口。 */
  previous?: {
    locator: AttemptLocator;
  },
}
```

`detail` 让「缺什么」和「怎么补」留在同一格里，读者不必去别处找命令。
`previous` 不是结果或参考判定：它不进任何计数，也不显示旧 verdict，只提供 locator 下钻与 `accept` 授权入口。
缺口原因由 Sample 的 `never-run` / `previous-result` 决定；格只投影这份结构化判断。
[实验表的缺口行](../components/summaries/experiment-table.md#缺口原因与动作)是它的第一个消费者。

## 文本排版

表格之外的形态要自己写 text 面时，用这组纯函数。
不要用 `String.prototype.padEnd` / `padStart` 对齐：它们数的是 UTF-16 码元，不是终端显示列宽，agent 名或 eval id 一带中文，整张表就撕歪。
签名见[总表](#公开函数总表)的文本排版分组。

`Table` 与官方数据源的 text 面建在同一把尺子上，自定义表因此和官方表逐列对齐。

## 实验颜色与维度呈现

「这个实验的点、柱、线用哪个颜色」不是组件的自由：分配单位是**页**，规则单点声明在[页级呈现分配](../components/README.md#维度呈现分配单位是页)，包括两个 keyset 与 24 个视觉身份的容量上界。
这里只给类型与用法。

名称与视觉编码是**一份**呈现结果。
库不公开两套 helper 让作者自己拼接：标签取自这一页的完整 keyset，颜色取自这一页的槽位分配，任何一半自己算都会与另一半脱节。

组件先声明，再按句柄取回：

```ts
type DimensionEncoding =
  | { readonly kind: "label" }
  | { readonly kind: "color" }
  | { readonly kind: "series"; readonly mark: "line" | "scatter" | "bar" | "area" };

interface DimensionDeclaration<E extends DimensionEncoding> {
  readonly dimension: string;
  readonly encoding: E;
  /** 顺序与 renderer 使用的数据项顺序一致；允许重复值。 */
  readonly values: readonly string[];
}

type DimensionDeclarations = Readonly<Record<string, DimensionDeclaration<DimensionEncoding>>>;
```

取回的呈现按声明的编码判别，三种状态各是一支，不用可选的 `color` 把它们混在一起：

```ts
interface PresentationIdentity {
  /** 完整维度值，作为排序、筛选、React key 与证据身份。 */
  readonly value: string;
  /** 当前页完整 label keyset 内生成的显示名。 */
  readonly label: string;
}

interface LabelPresentation extends PresentationIdentity {
  readonly kind: "label";
}

interface ColorPresentation extends PresentationIdentity {
  readonly kind: "color";
  /** `var(--niceeval-color-series-N)`。 */
  readonly color: string;
}

interface LineSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "line";
  readonly stroke: string;
  readonly strokeDasharray: string;
  readonly marker: {
    readonly path: string;
    readonly viewBox: string;
    readonly fill: string;
    readonly stroke: string;
  };
}

interface ScatterSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "scatter";
  readonly marker: LineSeriesPresentation["marker"];
}

interface FillSeriesPresentation extends PresentationIdentity {
  readonly kind: "series";
  readonly mark: "bar" | "area";
  /** 颜色，或可直接使用的 `url(#pattern-id)`。 */
  readonly fill: string;
  readonly stroke: string;
  readonly strokeDasharray: string;
}

type DimensionPresentation =
  | LabelPresentation
  | ColorPresentation
  | LineSeriesPresentation
  | ScatterSeriesPresentation
  | FillSeriesPresentation;

type PresentationFor<E extends DimensionEncoding> =
  E extends { kind: "label" } ? LabelPresentation :
  E extends { kind: "color" } ? ColorPresentation :
  LineSeriesPresentation | ScatterSeriesPresentation | FillSeriesPresentation;

interface ResolvedDimension<P> {
  readonly length: number;
  at(index: number): P;
}

interface RenderContext<D extends DimensionDeclarations> {
  locale: ReportLocale;
  dimension<K extends keyof D>(handle: K): ResolvedDimension<PresentationFor<D[K]["encoding"]>>;
}

function presentDimension<E extends DimensionEncoding>(
  declaration: DimensionDeclaration<E>,
): ResolvedDimension<PresentationFor<E>>;
```

组件里的完整写法是「声明一次、按下标取回」：

```tsx
dimensions: (data) => ({
  experiments: {
    dimension: "experiment",
    encoding: { kind: "series", mark: "scatter" },
    values: data.points.map((point) => point.experimentId),
  },
}) as const,

web: (data, _options, ctx) => {
  const experiments = ctx.dimension("experiments");
  return data.points.map((point, index) => {
    const it = experiments.at(index);
    return <circle key={it.value} fill={it.marker.fill} …>{it.label}</circle>;
  });
},
```

**实验的身份始终是完整 experiment id。**
`values` 填完整 id，`dimension` 写 `"experiment"`；标签由管线按整页 keyset 算成最短唯一后缀，组件不截路径末段。
缩短后的显示标签不能反过来充当身份。

**呈现值可以直接用。**
`color`、`strokeDasharray`、`marker.path`、`fill` 都能原样交给 SVG / CSS 属性；pattern definitions 由运行时注入文档。
自定义组件不手写 pattern，也不把枚举名翻译成 SVG——否则「声明了 series 却没实现 variant」会让 7–12 号身份看起来和 1–6 号一模一样。

**按句柄与下标取，不按值查。**
复合键（`` `${agentId}/${model}` ``）只在 `dimensions()` 里派生一次，renderer 不重新拼，两处派生逻辑因此不可能分叉。

未声明的句柄、越界的下标或与声明编码不符的用法按完整用户反馈报错，而不是临时分配。
text renderer 的 `ctx.dimension()` 恒返回 label 面：text 面不上 ANSI 色，拿不到颜色、线型或 pattern。

自有 React 页面没有 page 管线，调用 `presentDimension(declaration)` 传入同一形状的声明。
两条入口返回同一种结果。

普通语义色不走这条通道，直接读 CSS 令牌：`--niceeval-color-accent`、`--niceeval-color-positive`、`--niceeval-color-negative`、`--niceeval-color-warning` 与中性面令牌。
需要另一套品牌色时写[报告主题](theme.md)，不在组件里复制色板。

## 不公开的东西

| 想做的事 | 不公开 | 用什么 | 为什么 |
|---|---|---|---|
| 按类型挑格式化函数 | 耗时 / 金额 / 百分比各自的 formatter | `formatMetricValue` + `unit` | 挑得动就会挑错，同一读数在两处显示不一致 |
| 直接取实验色 | 色板数组、槽位号、class 名、hex | `ctx.dimension()` / `presentDimension()` | 绕开页级消解，暗色主题下还会取到错的值 |
| 自己排一张对齐的表 | 整表对齐渲染件 | [`Table`](layout.md#table) | 身份列下限、超宽丢列与如实标注是表格契约，不是排版细节 |
| 拿到主题对象 | 主题值 | CSS 令牌与语义 class | 主题只能通过 CSS 改变呈现，不能改变 data 或组件树 |

## 相关阅读

- [排版原语与自定义组件](layout.md) —— 报告树的节点、原语与 `defineComponent`。
- [读数与维度](measures.md) —— `Calculation`、`unit`、聚合口径与维度声明。
- [`Table`](../components/primitives/table.md) —— `Cell` 全集与每种格子的两面渲染契约。
- [页级呈现分配](../components/README.md#维度呈现分配单位是页) —— 槽位分配规则与容量上界。
- [主题](theme.md) —— 令牌全集与 CSS 出口。
