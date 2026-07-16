# 指标组件

把 [指标](metrics.md) 投影成榜单、矩阵、条形、散点、趋势与差异表。每个组件的 props 由**数据来源**与**呈现选项**组成，数据来源二选一（模型见 [Architecture · 组件模型](../architecture.md#组件模型解析面与渲染面)）：

```tsx
// spec 形态：计算选项直接作为 props，input 省略时取宿主注入的 Scope
<MetricTable rows="agent" columns={[endToEndPassRate, costUSD]} filter />

// data 形态：接收配套 *Data 函数算好的数据
<MetricTable data={await metricTableData(scope, options)} filter />
```

统一的组合规则，本页各组件不逐个重复：

```ts
type DataProps<Data, Options, Presentation> =
  | ({ data: Data } & Presentation)
  | ({ input?: ReportInput } & Options & Presentation);
```

spec 形态与「先手工调 `*Data` 再传 `data`」严格等价；同一组件同时给出 `data` 与 spec 字段按完整用户反馈报错。所有计算函数的第一参数都是 [`ReportInput`](metrics.md#公开计算模型)；所有 data 都是可序列化普通数据。`niceeval/report/react` 入口的同名组件只有 data 形态。

数组顺序只有两类：`questions`、`pairs`、`metrics` 等作者显式传入的列表保留声明顺序；从数据发现的维度 domain 按稳定 key 字典序。组件级 `sort` 是稳定排序，同值时仍以 key 收口。这个规则适用于 text、web 和写出的 JSON，不让文件扫描顺序渗进报告。

## 共用数据形状

```ts
interface TableData {
  dimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

interface MatrixData {
  rows: string;
  columns: string;
  metric: MetricColumn;
  /** 稀疏格子：没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}

interface ScatterData {
  points: string;
  series?: string;
  x: MetricColumn;
  y: MetricColumn;
  rows: Array<{
    key: string;
    series?: string;
    x: MetricCell;
    y: MetricCell;
  }>;
}
```

## `MetricTable`

一行一个维度值，一列一个指标。`sort` 决定初始顺序，方向由指标的 `better` 决定；`filter` 只给 web 面增加行过滤框。`sort` 必须是 `columns` 中同一个 Metric 实例且声明了 `better`，否则计算以完整用户反馈失败；省略时按行 key 字典序，避免为“更好”方向不明的指标猜顺序。

```ts
interface MetricTableOptions {
  rows: DimensionInput;
  columns: readonly [Metric, ...Metric[]];
  sort?: Metric;
  /** eval id 前缀；与 CLI 位置参数同语义。 */
  evals?: string | readonly string[];
}

function metricTableData(
  input: ReportInput,
  options: MetricTableOptions,
): Promise<TableData>;

type MetricTableProps = DataProps<TableData, MetricTableOptions, {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<MetricTable
  rows="agent"
  columns={[endToEndPassRate, examScore, costUSD, durationMs]}
  sort={endToEndPassRate}
  evals="coding/"
  filter
/>
```

## `MetricMatrix` 与 `MetricBars`

二者使用同一份 `MatrixData`：Matrix 适合看“题 × 配置”的格子，Bars 适合比较每行的相对大小。

```ts
interface MetricMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  evals?: string | readonly string[];
}

function metricMatrixData(
  input: ReportInput,
  options: MetricMatrixOptions,
): Promise<MatrixData>;

type MetricMatrixProps = DataProps<MatrixData, MetricMatrixOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type MetricBarsProps = MetricMatrixProps;
```

```tsx
<MetricMatrix rows="eval" columns="agent" cell={endToEndPassRate} />
<MetricBars rows="eval" columns="agent" cell={endToEndPassRate} />
```

两个组件写同一份 spec 时，resolve 记忆化保证矩阵只计算一次——不需要为共享数据退回手工 `metricMatrixData`。矩阵是稀疏的：没有 attempt 的组合不生成格子。格子中的 `refs` 保留证据引用；在自有页面中传 `attemptHref` 可令格子跳到自己的 attempt 页。

## `Scoreboard`

Scoreboard 先接收一份显式固定题集，再把每个行维度在每道题上的分数折成总分和分科得分。组件不从已观测 attempt 的并集猜题集；因此“所有配置都没跑到的题”仍然留在分母中并按 0 分计。

```ts
interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集；eval id 必须唯一、数组必须非空。 */
  questions: readonly [string, ...string[]];
  /** 分科函数；默认取 eval id 第一段。 */
  subject?: (evalId: string) => string;
  /** 权重按 eval id 前缀匹配，多个命中时最长前缀生效；默认 1。 */
  weights?: Readonly<Record<string, number>>;
  fullMarks?: number;
  score?: Metric;
}

interface ScoreboardData {
  dimension: string;
  questions: string[];
  fullMarks: number;
  weights: Array<{ prefix: string; weight: number }>;
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      missing: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      missing: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}

function scoreboardData(
  input: ReportInput,
  options: ScoreboardOptions,
): Promise<ScoreboardData>;

type ScoreboardProps = DataProps<ScoreboardData, ScoreboardOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<Scoreboard
  rows="agent"
  questions={[
    "security/sql-injection",
    "security/path-traversal",
    "correctness/retry",
  ]}
  weights={{ "security/": 3, "correctness/": 2 }}
  fullMarks={100}
  score={examScore}
/>
```

`score` 默认是 `examScore`，每道题必须产出 `[0, 1]`；同一行中同一个 experiment × eval 的多轮先用该 Metric 的 `perEval` 聚合，同题横跨多个 experiment 时再用 `across` 聚合。`null` 与完全未运行都按该题 0 分并增加 `missing`。题目得分乘最长前缀命中的权重，未命中权重为 1；总分是 `fullMarks × earned / possible`，`fullMarks` 默认 100，分科显示 `earned / possible` 与同尺度百分比。

Scope 中存在题集之外的 eval 时，Scoreboard 忽略它们，把数量写进 `ignoredEvals` 并在注脚显示；`questions` 重复、空数组、空权重前缀、`fullMarks <= 0`、非正或非有限权重、score 超出 `[0, 1]`，或 `subject()` 返回空字符串时，计算以完整用户反馈失败，不产出歧义成绩单。

## `MetricScatter`

每个点是一个维度值，x / y 各一个指标，`series` 只决定颜色和分组，默认不连线。散点之间没有天然顺序；需要表达参数进程时使用 `MetricLine`，不把同 agent 的无关实验连成一条虚构路径。

```ts
interface MetricScatterOptions {
  points: DimensionInput;
  series?: DimensionInput;
  x: Metric;
  y: Metric;
  evals?: string | readonly string[];
}

function metricScatterData(
  input: ReportInput,
  options: MetricScatterOptions,
): Promise<ScatterData>;

type MetricScatterProps = DataProps<ScatterData, MetricScatterOptions, {
  pointHref?: (row: ScatterData["rows"][number]) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
```

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时显示明确空态；只有一个可画点时照常画出。

web 面每个点都有直接标签。当点维度是 experiment 时，只有在当前 data 中末段唯一才缩成末段；发生重名时使用能区分它们的最短路径后缀，完整 id 与两轴值仍进 tooltip。标签布局保证不静默丢标签；冲突时使用 leader line 连回原点。

`MetricScatter` 是通用分析组件，不根据 experiment id 隐式分区。默认 `ExperimentComparison` 会先按可比组过滤后逐组计算；自定义报告直接消费跨组 Scope 时，跨组同图是作者的显式选择。

## `MetricLine`

`MetricLine` 只接受 [`NumericAxis`](metrics.md#维度与数值轴) 作为 x 轴，按 series 画指标趋势。字符串配置必须显式映射到数值；组件不猜 `low < medium < high`。

```ts
interface MetricLineOptions {
  x: NumericAxis;
  series?: DimensionInput;
  y: Metric;
  evals?: string | readonly string[];
}

interface LineData {
  x: { key: string; label: LocalizedText; unit?: string };
  series?: string;
  y: MetricColumn;
  rows: Array<{
    key: string;
    series?: string;
    x: number | null;
    xDisplay: LocalizedText;
    y: MetricCell;
  }>;
}

function metricLineData(
  input: ReportInput,
  options: MetricLineOptions,
): Promise<LineData>;

type MetricLineProps = DataProps<LineData, MetricLineOptions, {
  pointHref?: (row: LineData["rows"][number]) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
<MetricLine x={budget} series="agent" y={endToEndPassRate} />
```

`x.of()` 返回 `null` 的 attempt 不伪造 x 值，组件报告未绘制数量。同一 series 中 x 值重复时，先按同一 experiment × eval 的两级指标口径合并为一个点，不画垂直来回线。

## `DeltaTable`

`DeltaTable` 成对比较同一个显式维度上的 A 与 B。`by` 是必填，因此 `"baseline"` 不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。

```ts
interface DeltaPair {
  label: LocalizedText;
  a: string;
  b: string;
}

interface DeltaTableOptions {
  by: DimensionInput;
  pairs: readonly [DeltaPair, ...DeltaPair[]];
  metrics: readonly [Metric, ...Metric[]];
  evals?: string | readonly string[];
}

interface DeltaData {
  by: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    a: { key: string };
    b: { key: string };
    cells: Record<string, {
      a: MetricCell;
      b: MetricCell;
      /** b.value - a.value；任一侧缺失则为 null。 */
      delta: number | null;
      display: LocalizedText;
      outcome: "improved" | "regressed" | "unchanged" | "unavailable";
    }>;
  }>;
}

function deltaTableData(
  input: ReportInput,
  options: DeltaTableOptions,
): Promise<DeltaData>;

type DeltaTableProps = DataProps<DeltaData, DeltaTableOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<DeltaTable
  by="experiment"
  pairs={[{ label: "memory", a: "compare/baseline", b: "compare/with-memory" }]}
  metrics={[endToEndPassRate, costUSD, durationMs]}
/>
```

`a` / `b` 未命中时保留该 pair，对应侧格子为缺失；不把缺失当 0，不因一侧缺失把整行静默删掉。同一 `by` 值对应多个 experiment / snapshot 时，依然按通用两级指标口径聚合；需要一对一时选择更精确的维度。

`a` / `b` 与分组后得到的维度 key 精确匹配，不做前缀或模糊匹配；pair label 不得为空且在数组内唯一，`a === b` 直接报错。`pairs` 与 `metrics` 都必须非空。

## 相关阅读

- [指标与维度](metrics.md) —— 这些组件消费的指标、分组维度与数值轴。
- [概览组件](summaries.md) —— 默认报告怎样逐组组合散点与列表。
- [排版原语与自定义组件](layout.md) —— 把多个指标视图组织成报告树。
