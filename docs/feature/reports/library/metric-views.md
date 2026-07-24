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

`evals` 是各组件唯一的数据过滤选项：eval id 前缀，与 CLI 位置参数同语义，在聚合**之前**收窄题集——聚合发生在计算函数内部，事后 JavaScript 无法从聚合值还原题级过滤，所以它必须是选项。逐实体成行的[实体列表](entity-lists.md)不设它：列表数据的聚合边界就是单实体，取数后用普通 JavaScript 过滤与任何选项严格等价。

数组顺序只有两类：`questions`、`pairs`、`metrics` 等作者显式传入的列表保留声明顺序；从数据发现的维度 domain 按稳定 key 字典序。组件级 `sort` 是稳定排序，同值时仍以 key 收口。这个规则适用于 text、web 和写出的 JSON，不让文件扫描顺序渗进报告。

## 共用数据形状

数据形状的字段命名只有一条规则：**维度名字段 = 产生它的选项名 + `Dimension` 后缀**（`rows` → `rowDimension`、`points` → `pointDimension`、`by` → `byDimension`），值是解析后的维度 name；条目数组一律叫 `rows`，Matrix 的稀疏格子叫 `cells`。条目内的 `key` / `series` 是维度**值**，不带后缀。

```ts
interface TableData {
  rowDimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子：没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}

interface ScatterData {
  pointDimension: string;
  seriesDimension?: string;
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
  /** 固定题集；eval id 必须唯一。元素引用运行时数据，类型放宽为普通数组，空数组在计算时按完整用户反馈报错。 */
  questions: readonly string[];
  /** 分科函数；默认与 evalGroup 维度同一条规则：取 eval id 的完整父路径，无 `/` 取完整 id。 */
  subject?: (evalId: string) => string;
  /** 权重按 eval id 前缀匹配，多个命中时最长前缀生效；默认 1。 */
  weights?: Readonly<Record<string, number>>;
  fullMarks?: number;
  score?: Metric;
}

interface ScoreboardData {
  rowDimension: string;
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
      /** 题集中该行完全没有 attempt 的题数。 */
      notRun: number;
      /** 有 attempt 但指标为 null（测不了）的题数。 */
      unscorable: number;
      refs: AttemptLocator[];
    };
    subjects: Array<{
      key: string;
      /** 加权后的 [0, 1] 题目分数之和。 */
      earned: number;
      /** 本分科题目的权重之和。 */
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
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

`score` 默认是 `examScore`，每道题必须产出 `[0, 1]`；同一行中同一个 experiment × eval 的多轮先用该 Metric 的 `perEval` 聚合，同题横跨多个 experiment 时再用 `acrossEvals` 聚合。分数口径上，指标为 `null`（跑了但测不了）与完全未运行都按该题 0 分——固定题集的分母不缩水；但两者分开计数为 `unscorable` 与 `notRun`，成绩单能回答「这 0 分是没去考还是考了判不了」，渲染面把两个计数连同 `refs` 一起显示，不合并成一个笼统的缺失数。题目得分乘最长前缀命中的权重，未命中权重为 1；总分是 `fullMarks × earned / possible`，`fullMarks` 默认 100，分科显示 `earned / possible` 与同尺度百分比。

Scope 中存在题集之外的 eval 时，Scoreboard 忽略它们，把数量写进 `ignoredEvals` 并在注脚显示；`questions` 重复、空数组、空权重前缀、`fullMarks <= 0`、非正或非有限权重、score 超出 `[0, 1]`，或 `subject()` 返回空字符串时，计算以完整用户反馈失败，不产出歧义成绩单。

## 图轴值域

`MetricScatter` 的两轴与 `MetricLine` 的两轴按同一条规则推定值域，分两步：

**呼吸边距**：数据极值向两端各扩数据跨度的 20%，数据极值点不落在绘图框线上。落在框线上的点标记被框线穿过、视觉上残缺，而极值点（最好与最差）恰是图上最需要被完整看清的点；边距同时给极值点旁的文字标签留出排布空间。数据跨度为零（单点，或全部点同值）时，边距改取该值绝对值的 20%；值恰为 0 时取 1。

**最小跨度下限**：扩完边距后，值域跨度不得小于量程参考的 1/3。值域若永远贴着数据画，数据聚集时微小差距会撑满整个绘图区，读者把噪声读成显著差异；下限保证 1 个单位的差距在图上占的比例有上界。不足下限时以数据为中心向两端对称扩展补足，一端被 `bounds` 顶住时余量推到另一端。量程参考取自指标声明的 `bounds`（自然边界，见[指标](metrics.md)）：两端都声明时为 bounds 全量程——通过率的参考是 0–100%，值域至少画 33 个百分点；只声明一端时为声明端到数据另一侧极值的距离——成本的参考是 $0 到数据最大值；两端都未声明的轴（`MetricLine` 的 x 轴 `NumericAxis`）没有量程参考，不适用下限。

声明了 `bounds` 的轴，边距与下限扩展都截到边界为止：通过率 100% 的点落在框线上是「顶到语义天花板」的如实呈现，不是裁剪——此时框线就是指标的自然边界。

边距是呈现，与 `connect` 同一定性：不改变 `ScatterData` / `LineData`，不产生假刻度——刻度取扩后值域内的整值、标签始终显示真实值；反向轴（`better: "lower"`）先扩边距再反向。text 面的字符坐标图共用同一份值域，按字符行列粒度取整。

## `MetricScatter`

每个点是一个维度值，x / y 各一个指标，`series` 决定颜色和图例归类，默认不连线。`connect` 显式开启后，每个 series 内的点按 x 升序连成折线——只给「线 = 同族变体」的 lineage series 用：基线与加了某个机制的变体同线，连线显示位移。散点云之间没有天然顺序，对无关点连线只会画出虚构趋势；表达数值参数的进程用 `MetricLine`。

```ts
interface MetricScatterOptions {
  points: DimensionInput;
  /** 数组形态解析为复合维度，见指标与维度页。 */
  series?: SeriesInput;
  x: Metric;
  y: Metric;
  evals?: string | readonly string[];
}

function metricScatterData(
  input: ReportInput,
  options: MetricScatterOptions,
): Promise<ScatterData>;

type MetricScatterProps = DataProps<ScatterData, MetricScatterOptions, {
  /** series 内按 x 升序成线：web 面画折线，text 面在图例给逐段位移摘要；默认 false。连线是呈现，不改变 ScatterData。 */
  connect?: boolean;
  pointHref?: (row: ScatterData["rows"][number]) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />

// lineage 归类:同 line 值的实验一色成线,connect 连出基线 → 变体的位移
<MetricScatter points="experiment" series={label("line")} connect x={costUSD} y={endToEndPassRate} />

// 同一份 labels 声明横切:按记忆机制归类,跨 agent 比较机制本身
<MetricScatter points="experiment" series={label("memory")} x={costUSD} y={endToEndPassRate} />
```

**轴方向跟随指标的 `better`，「更好」恒指向右与上**：`better: "lower"` 的轴反向渲染（如成本轴左贵右便宜），`better: "higher"` 正向；角落提示因此恒为「越靠右上越好」。刻度标签始终显示真实值，反向只改方向不改数字；未声明 `better` 的轴正向渲染，且该图不出方向提示——组件不猜「更好」朝哪边。text 与 web 两面同一规则。

text 面是字符坐标图，web 面是 SVG，两面同一份数据与同一套顺序规则。点用标记字母 `A`、`B`、`C`… 标识，分配顺序即图例顺序：series 按显示键字典序，series 内按 x 原始值升序，无 series 时全部点按点维度键字典序。图例一行一个 series，行首是 series 显示键，后接该 series 各点的标记与 id。图表标题行尾显示归类维度（`· 按 line 归类`）。

`connect` 开启时，图例把 series 内各点以 ` → ` 串联（顺序同 x 升序），并为每段相邻点在下一行给出**位移摘要**——两轴指标的带符号差值（`通过率 +37.5pt · 成本 +$0.13`，`%` 的差是百分点、单位写 `pt`）；text 面不在坐标图里画折线，位移摘要就是线的 text 投影，web 面按同一顺序绘制折线。单点 series 无箭头无摘要。完整终端示例见 [`show` · 裸 show 的默认报告](../show/default-report.md)。

series 配色以稳定散列为起点（同键跨图同色）；同一张图内撞色时按图例顺序线性探测下一个空色格，键数超过色板才复用——跨图稳定让位给图内可辨。

x 或 y 缺失的点不绘制，并显示缺失数量。零个可画点时显示明确空态；只有一个可画点时照常画出。

web 面每个点都有直接标签。当点维度是 experiment 时，只有在当前 data 中末段唯一才缩成末段；发生重名时使用能区分它们的最短路径后缀，完整 id 与两轴值仍进 tooltip。标签布局保证不静默丢标签；冲突时使用 leader line 连回原点。这份「最短唯一后缀」算法与 [`ExperimentList`](entity-lists.md#experimentlist) 行标签共用同一份实现，同一个 experiment id 在散点和列表里缩成同一个显示名。

`MetricScatter` 是通用分析组件，直接消费调用方给出的 Scope，不根据 experiment id 隐式分区。默认 `ExperimentComparison` 也把宿主 Scope 原样交给它。

## `MetricLine`

`MetricLine` 只接受 [`NumericAxis`](metrics.md#维度与数值轴) 作为 x 轴，按 series 画指标趋势。字符串配置必须显式映射到数值；组件不猜 `low < medium < high`。

```ts
interface MetricLineOptions {
  x: NumericAxis;
  /** 数组形态解析为复合维度，见指标与维度页。 */
  series?: SeriesInput;
  y: Metric;
  evals?: string | readonly string[];
}

interface LineData {
  x: { key: string; label: LocalizedText; unit?: string };
  seriesDimension?: string;
  y: MetricColumn;
  rows: Array<{
    /** 点身份 = (series, x)：x 值的稳定十进制字符串，同一 series 内唯一。 */
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

// 一条线 = 一个 series 维值:同 (agent, memory) 的实验沿 budget 轴连成线
<MetricLine x={budget} series={["agent", label("memory")]} y={endToEndPassRate} />
```

点的身份模型是确定的：**一个点 = 一个 `(series, x)` 组合**。落进同一 `(series, x)` 桶的全部 attempt 先在各自 experiment × eval 内用 y 指标的 `perEval` 聚合，再用 `acrossEvals` 跨题折成该点唯一的 y 值——聚合顺序是 `(series, x, experiment, eval)`，同一桶里有多个 experiment 时它们合成一个点，不画垂直来回线。前提是 x 在同一 experiment × eval 内恒定：`numericFlag()` / `numericRunConfig()` 读 experiment 级配置，天然满足；自定义 `NumericAxis.of()` 若对同一 experiment × eval 的不同 attempt 返回不同值，计算以完整用户反馈失败——逐 attempt 变化的量是 y 指标的素材，不是参数轴。`x.of()` 返回 `null` 的 attempt 不伪造 x 值，组件报告未绘制数量。

## `DeltaTable`

`DeltaTable` 把同一批 eval 在一组有序条件下的对照展开成表：每行是一道 eval，每组列是一个条件，条件按声明顺序排列，**首个是基准**，其余各自对基准求 delta。`by` 是必填，声明条件取值所在的维度（如 `"experiment"`、`"agent"`、`"snapshot"`）；`"baseline"` 因此不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。`conditions` 有两种形态：**字面有序数组**逐个写死该维度上的取值；**`conditionsByFlag()` 派生声明**按一个 flag 机械导出全部条件——实验矩阵是「同配置开关某个 flag」时，条件关系本来就是 experiment 配置的推论，手抄 id 字面量等于把配置复写进报告，加实验后报告会静默缺列。终端里多个 `--exp` 的[对照矩阵](../show/compare.md)是这个组件的一处零配置装配——同一批题在终端与报告页得到相同的行、相同的数字。

```ts
/** 按 flag 派生有序条件；只在 by 为 "experiment" 时成立。 */
interface FlagConditions {
  readonly kind: "flagConditions";
  readonly flag: string;
  /** 基准侧的 flag 取值；缺省表示「未声明该 flag」的实验作基准。 */
  readonly baseline?: JsonValue;
}

function conditionsByFlag(name: string, options?: { baseline?: JsonValue }): FlagConditions;

interface DeltaTableOptions {
  by: DimensionInput;
  /** 有序条件值，取自 by 维度；长度 ≥ 2，首个是基准。空数组、单元素或重复值在计算时按完整用户反馈报错。 */
  conditions: readonly [string, string, ...string[]] | FlagConditions;
  /** eval id 前缀；与 CLI 位置参数同语义。 */
  evals?: string | readonly string[];
}

interface DeltaData {
  byDimension: string;
  /** 有序条件值，首个是基准。 */
  conditions: string[];
  /** conditionsByFlag 派生形态下的候选实验数；0 候选时空态据此报「N 个实验、0 个可配对条件」，字面 conditions 不携带。 */
  experiments?: number;
  rows: Array<{
    /** 行的配对身份：eval id。 */
    key: string;
    /** 各条件判定不一致时 true——翻转标记 ⇄ 的数据面。 */
    flipped: boolean;
    cells: Record<string, {   // 键是条件值；该条件没有这道题的结果时无键，渲染为占位 —
      scoring: "pass" | "points";
      /** 复用 Results 的判定枚举，不为组件发明第二套。 */
      verdict: AttemptRecord["verdict"];
      /** 计分制的题目级挣分；通过制省略——计分制没有满分分母。 */
      totalScore?: number;
      attempts: readonly AttemptLocator[];
      totalTokens?: number;
      totalCostUSD?: number;
      /** true 时该格来自跨快照携带的历史执行，渲染为 ↩ 时效标注。 */
      historical: boolean;
    }>;
    /** 键是非基准条件值；任一侧缺数据时无键——delta 不把缺失当 0。 */
    delta?: Record<string, { score?: number; tokens?: number; costUSD?: number }>;
  }>;
  /** 各条件自身覆盖面的描述，分母是该条件有结果的 eval 数；不用于跨条件直接归因。 */
  totals: Record<string, {
    scoringComposition: "pass" | "points" | "mixed";
    passed?: number; denominator?: number; // pass / mixed
    totalScore?: number;                   // points / mixed
    totalTokens?: number; totalCostUSD?: number;
  }>;
  /** 只在每个条件与基准的共同 eval 集上计算；键是非基准条件值。 */
  pairedDelta: Record<string, {
    commonEvalIds: string[];
    /** mixed 时各自在对应题型子集配对，不共用一个含混分母。 */
    pass?: { evalIds: string[]; passRatePoints: number };
    points?: { evalIds: string[]; totalScore: number };
    tokens?: number;
    costUSD?: number;
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
// 字面形态:显式列出有序条件,首个是基准
<DeltaTable by="experiment" conditions={["compare/baseline", "compare/with-memory"]} />

// 派生形态:按 flag 机械导出条件,加实验不用改报告
<DeltaTable by="experiment" conditions={conditionsByFlag("memory")} />
```

`conditionsByFlag` 的派生规则是确定的：

- **条件域**：input 中 `by` 维度的全部取值（如全部 experiment）。收窄后的取值必须在删除该 flag 后[可比性配置](../../results/library.md#官方现刻水位resultscurrent)深相等——它们是同一组配置的不同 flag 取值，不是互不相关的两批实验；不满足时计算以完整用户反馈报错，提示按 `evals` 或输入范围收窄成单一组。
- **基准与候选**：基准取 `baseline` 声明的 flag 值，缺省为「未声明该 flag」；候选是该 flag 每个其它取值各一个条件，按显示键字典序排在基准之后。
- **0 候选不是错误**：收窄后配不出任何候选时显示明确空态并报告「N 个实验、0 个可配对条件」；`by` 不是 `"experiment"` 时按完整用户反馈报错。

字面形态的元素与分组后得到的维度值精确匹配，不做前缀或模糊匹配；元素在数组内唯一，长度小于 2 时按完整用户反馈报错。两种形态共同的聚合行为：

- **配对身份是 eval id**：同一 eval id 在各条件下的结果进同一行；`evals` 选项与 CLI 位置参数同语义收窄行集。
- **单格折叠**：每个 cell 是该条件值 × eval 的折叠——`verdict` / `totalScore` 用与榜单同一套题目级判定口径，`totalTokens` / `totalCostUSD` 是该题在该条件下全部 attempt 的合计。同一条件值对应多个 experiment / snapshot 时（`by` 不是 `"experiment"`，或现刻水位由多个贡献快照撑起），cell 仍按这份折叠规则合并该组合下的全部 attempt。
- **翻转标记**：`flipped` 只在该行各条件判定不一致时为 true，供渲染面叠加 `⇄`；全部一致的行不加噪声。
- **占位与时效**：某条件没有该 eval 的结果时 `cells` 无该条件的键，渲染面显示占位 `—`，该题不计入该条件在 `totals` 里的分母；`historical` 为 true 的格来自跨快照携带的历史执行，渲染面叠加 `↩ <时距>`，与[实体列表的时效标注](entity-lists.md#时效标注)同一条呈现规则。
- **混型分段**：eval 集横跨通过制与计分制时，`totals[condition].scoringComposition` 为 `"mixed"`——通过制子集报 `passed / denominator`，计分制子集报 `totalScore`，两制不压成一个综合分；`totalTokens` / `totalCostUSD` 不分制，在该条件全部有结果的题上合计。
- **共同题 paired delta**：`pairedDelta[condition]` 只在该条件与基准都存在结果的 eval 交集（`commonEvalIds`）上计算——先在同一题上配对，再分别聚合判定与用量；`totals` 是各条件自身覆盖面的描述，两者分母不同，不能互相替代或拿来直接归因。`pass` / `points` 按共同题各自的题型分别给出，mixed 时两者都出现。
- **方向**：`score` 越高越好，`tokens` / `costUSD` 越低越好，符号由此固定；组件只呈现带符号差值，不替读者下结论。

行按 `key`（eval id）字典序排列；空 `rows` 两面零输出。web 面 `flipped` 为真的行叠加翻转标记，某条件的 `attempts` 非空且传了 `attemptHref` 时对应格可点开跳到对应 attempt 页，长度大于 1 时格内标 `×N`。text 面按同一份行序展开，条件按 `conditions` 顺序分组列出。

## `StabilityMatrix`

`StabilityMatrix` 是一张历史全执行的稳定性矩阵：行是 eval，列是 `by` 维度上的取值（通常是 experiment），格是该组合**全部历史执行**（跨快照按[身份键](../../results/library.md#身份键与去重)去重、不设可比性门槛）的判定计数。它回答「这道题在这个条件下历史上稳不稳」，不是现刻水位下「现在算不算过」——分工上与消费 Scope 现刻水位的 `MetricMatrix` 不同：`MetricMatrix` 的每个格是一次两级指标聚合，服务发布用的可比读数；`StabilityMatrix` 的每个格是原始计数，服务「哪些题从来没通过过」这类题目质量诊断，覆盖 `--fresh` 收窄之外的全部历史。终端 [`--stats`](../show/stats.md) 是这个组件的一处零配置装配。

因为它消费的是历史全执行而非现刻水位，组合组件应从 `ctx.results` 显式选择要统计的 `Snapshot[]` 传入 `input`；宿主注入的默认 Scope 已经过现刻水位收窄，不是完整历史（见 [Architecture · Scope 是计算入口](../architecture.md#scope-是计算入口)）。

```ts
interface StabilityMatrixCell {
  passed: number;
  failed: number;
  errored: number;
  /** passed + failed + errored 之和；skipped 不计。 */
  executions: number;
}

interface StabilityMatrixData {
  rowDimension: string;
  columnDimension: string;
  rows: Array<{
    evalId: string;
    /** 全部条件历史执行中通过次数为 0 且执行数 > 0。 */
    neverPassed: boolean;
  }>;
  /** 贡献了至少一格的列值，字典序。 */
  columns: readonly string[];
  /** 稀疏格子：该 (eval, column) 组合没有任何历史执行时不生成格子，渲染面显示占位 —，不编三个 0 冒充跑过。 */
  cells: ReadonlyArray<{ row: string; column: string; cell: StabilityMatrixCell }>;
  /** 各列的合计。 */
  totals: Record<string, StabilityMatrixCell>;
}

interface StabilityMatrixOptions {
  by: DimensionInput;
  /** eval id 前缀；与 CLI 位置参数同语义。 */
  evals?: string | readonly string[];
}

function stabilityMatrixData(
  input: ReportInput,
  options?: StabilityMatrixOptions,
): Promise<StabilityMatrixData>;

type StabilityMatrixProps = DataProps<StabilityMatrixData, StabilityMatrixOptions, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<StabilityMatrix by="experiment" evals="coding/" />
```

行按历史最高通过率升序排列，零通过的题排最前——它们是题目质量审查的第一队列；同序值再按 `evalId` 字典序收口。格内三计数固定顺序 `✓ ✗ !`：`✗`（failed）与 `!`（errored）永远分列——判定失败是题目 / agent 的事实，基础设施错误是环境的事实，混进同一列会把环境事故误判成题目难度；`skipped` 不计入任何列。`totals` 给每列的三计数合计；某列的 `!` 合计异常高指向环境事故（限流、配额），矩阵只陈列计数，不替读者下结论。空 `rows` 两面零输出。

## 相关阅读

- [指标与维度](metrics.md) —— 这些组件消费的指标、分组维度与数值轴。
- [概览组件](summaries.md) —— 默认报告怎样逐组组合散点与列表。
- [排版原语与自定义组件](layout.md) —— 把多个指标视图组织成报告树。
