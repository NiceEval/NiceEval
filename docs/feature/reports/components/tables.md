# 表格与矩阵

把 [指标](../library/metrics.md) 投影成榜单、格子、成绩单、对照表与稳定性矩阵。每个组件的数据绑定住在结构子节点里，呈现选项是 props；组合规则见[组件树](README.md)。

```tsx
// spec 形态：结构子节点携带绑定，input 省略时取宿主注入的 Scope
<MetricTable filter>
  <Rows dimension="agent" sort={endToEndPassRate} />
  <Column metric={endToEndPassRate} />
  <Column metric={costUSD} />
</MetricTable>

// data 形态：接收配套 *Data 函数算好的数据，子节点只按 key 选择并附加呈现
<MetricTable data={await metricTableData(scope, options)} filter>
  <Column dataKey="cost-usd" name="每题成本" />
</MetricTable>
```

## 共用数据形状

数据形状的字段命名只有一条规则：**维度名字段 = 产生它的节点名 + `Dimension` 后缀**（`Rows` → `rowDimension`、`Columns` → `columnDimension`）；条目数组一律叫 `rows`，稀疏格子叫 `cells`。条目内的 `key` 是维度**值**，不带后缀。

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
```

## 维度绑定节点

`Rows` 与 `Columns` 是表格族的维度绑定节点，形状相同、由父组件决定哪个可用：

```ts
interface DimensionBindingProps {
  dimension: DimensionInput;
  /** 稳定排序的依据；必须是同组件内已声明且有 better 的 Metric。 */
  sort?: Metric;
  /** 只保留排序后的前 N 个维度值；要求同时给出 sort。 */
  limit?: number;
  /** limit 截掉的维度值聚成一行/一列，用这个名字；省略时直接截断。 */
  rest?: LocalizedText;
}
```

`sort` 的方向跟随 Metric 的 `better`，同值以维度 key 收口；省略时按 key 字典序，不为「更好」方向不明的指标猜顺序。`limit` / `rest` 的语义与[图表维度轴的排序与截断](charts.md#排序与截断)逐条相同——`rest` 是在合并后的 keyset 上重新聚合，不是把截掉的几行平均，因此它必须住在计算函数里。行列头的颜色来自[页级色分配](README.md#系列色分配单位是页)。

`dimension` 传数组即[复合维度](../library/metrics.md#维度与数值轴)：`["agent", label("memory")]` 的一个取值是一行，不是两行。

## `MetricTable`

一行一个维度值，一列一个指标。列按声明顺序排列。

```tsx
<MetricTable evals="coding/" filter>
  <Rows dimension="agent" sort={endToEndPassRate} />
  <Column metric={endToEndPassRate} />
  <Column metric={examScore} />
  <Column metric={costUSD} />
  <Column metric={durationMs} />
</MetricTable>
```

```ts
type ColumnProps =
  | { metric: Metric; dataKey?: string; name?: LocalizedText }
  | { dataKey: string; metric?: never; name?: LocalizedText };

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

type MetricTableProps = ComponentProps<TableData, {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

- 至少一个 `<Column>`，Metric name 在同一张表内唯一；`name` 覆盖列头显示名，不改变 Metric 的计算口径。
- `<Rows sort>` 引用的 Metric 必须是本表某个 `<Column>` 的 Metric 且声明了 `better`，否则计算以完整用户反馈失败。
- `filter` 只给 web 面增加行过滤框；排序与过滤是浏览状态，不改变数据与 text 面。
- data 形态下 `<Column dataKey>` 选择 `TableData.columns` 中的一列；未被引用的列不渲染，重复引用同一个 key 报错。

## `MetricMatrix`

行、列各一个维度，格子是一个指标。适合看「题 × 配置」的判定分布；要比较每行的相对大小，用 [`BarChart`](charts.md#容器) 的同一份维度绑定。

```tsx
<MetricMatrix>
  <Rows dimension="eval" />
  <Columns dimension="agent" />
  <Cells metric={endToEndPassRate} />
</MetricMatrix>
```

```ts
interface CellsProps {
  metric: Metric;
}

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

type MetricMatrixProps = ComponentProps<MatrixData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

矩阵是稀疏的：没有 attempt 的组合不生成格子，渲染面显示占位 `—`。格子中的 `refs` 保留证据引用，传了 `attemptHref` 时格子可跳到对应 attempt。恰好一个 `<Rows>`、一个 `<Columns>`、一个 `<Cells>`；缺任一个或重复声明按完整用户反馈报错。

## `Scoreboard`

先接收一份显式固定题集，再把每个行维度在每道题上的分数折成总分和分科得分。组件不从已观测 attempt 的并集猜题集，因此「所有配置都没跑到的题」仍留在分母中并按 0 分计。

题集与分科都是结构子节点：`<Question>` 是一道题，`<Subject>` 把若干题归成一个分科并给出该科的默认权重。

```tsx
<Scoreboard fullMarks={100} score={examScore}>
  <Rows dimension="agent" />

  <Subject name="security" weight={3}>
    <Question id="security/sql-injection" />
    <Question id="security/path-traversal" />
  </Subject>

  <Subject name="correctness" weight={2}>
    <Question id="correctness/retry" />
  </Subject>
</Scoreboard>
```

题目很多时用普通 JSX `map` 展开，权重仍挂在条目上：

```tsx
<Subject name="security" weight={3}>
  {SECURITY_EVALS.map((id) => <Question key={id} id={id} />)}
</Subject>
```

不需要分科命名时把 `<Question>` 直接放在 `<Scoreboard>` 下，分科取 eval id 的完整父路径（无 `/` 时取完整 id）：

```tsx
<Scoreboard fullMarks={100}>
  <Rows dimension="agent" />
  <Question id="security/sql-injection" weight={3} />
  <Question id="security/path-traversal" weight={3} />
  <Question id="correctness/retry" weight={2} />
</Scoreboard>
```

```ts
interface QuestionProps {
  /** eval id；在整份题集内唯一。 */
  id: string;
  /** 该题权重；省略时取所属 Subject 的 weight，再省略为 1。必须是正有限数。 */
  weight?: number;
}

interface SubjectProps {
  name: string;
  /** 本科题目的默认权重。 */
  weight?: number;
  children: QuestionNode | readonly QuestionNode[];
}

interface ScoreboardData {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 逐题解析后的权重，按题集声明顺序。 */
  weights: Array<{ evalId: string; subject: string; weight: number }>;
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

interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集，逐题带分科与权重；顺序即声明顺序。空题集在计算时按完整用户反馈报错。 */
  questions: readonly { id: string; subject: string; weight: number }[];
  fullMarks?: number;
  score?: Metric;
  evals?: string | readonly string[];
}

function scoreboardData(
  input: ReportInput,
  options: ScoreboardOptions,
): Promise<ScoreboardData>;

type ScoreboardProps = ComponentProps<ScoreboardData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

`score` 默认 `examScore`，每道题必须产出 `[0, 1]`；同一行中同一个 experiment × eval 的多轮先用该 Metric 的 `perEval` 聚合，同题横跨多个 experiment 时再用 `acrossEvals` 聚合。分数口径上，指标为 `null`（跑了但测不了）与完全未运行都按该题 0 分——固定题集的分母不缩水；但两者分开计数为 `unscorable` 与 `notRun`，成绩单能回答「这 0 分是没去考还是考了判不了」，渲染面把两个计数连同 `refs` 一起显示，不合并成一个笼统的缺失数。题目得分乘各自权重；总分是 `fullMarks × earned / possible`，`fullMarks` 默认 100，分科显示 `earned / possible` 与同尺度百分比。

推定分科名与某个显式 `<Subject name>` 相同时并入该科，权重仍逐题解析——权重是题目的属性，不因归到哪一科而改写。

Scope 中存在题集之外的 eval 时，Scoreboard 忽略它们，把数量写进 `ignoredEvals` 并在注脚显示。零个 `<Question>`、`id` 重复、`fullMarks <= 0`、非正或非有限权重、`<Subject name>` 为空字符串，或 score 超出 `[0, 1]` 时，计算以完整用户反馈失败，不产出歧义成绩单。

## `DeltaTable`

把同一批 eval 在一组有序条件下的对照展开成表：每行是一道 eval，每组列是一个条件。`<Columns>` 声明条件取值所在的维度，它的 `<Condition>` 子节点逐个写下该维度上的取值，其中恰好一个标 `baseline`——`"baseline"` 因此不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。行维度恒为 eval，没有 `<Rows>`。

```tsx
<DeltaTable>
  <Columns dimension="experiment">
    <Condition value="compare/baseline" baseline />
    <Condition value="compare/with-memory" />
  </Columns>
</DeltaTable>
```

实验矩阵是「同配置开关某个 flag」时，条件关系本来就是 experiment 配置的推论——手抄 id 字面量等于把配置复写进报告，加实验后报告会静默缺列。`<FlagConditions>` 按一个 flag 机械导出全部条件：

```tsx
<DeltaTable>
  <Columns dimension="experiment">
    <FlagConditions flag="memory" />
  </Columns>
</DeltaTable>
```

终端里多个 `--exp` 的[对照矩阵](../show/compare.md)是这个组件的一处零配置装配——同一批题在终端与报告页得到相同的行、相同的数字。

```ts
interface ConditionProps {
  /** 取自 Columns 维度的精确值；不做前缀或模糊匹配。 */
  value: string;
  /** 基准列；一张表内恰好一个。 */
  baseline?: boolean;
}

interface FlagConditionsProps {
  flag: string;
  /** 基准侧的 flag 取值；省略表示「未声明该 flag」的实验作基准。 */
  baseline?: JsonValue;
}

interface DeltaData {
  byDimension: string;
  /** 有序条件值，首个是基准。 */
  conditions: string[];
  /** FlagConditions 形态下的候选实验数；0 候选时空态据此报「N 个实验、0 个可配对条件」，字面条件不携带。 */
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

interface DeltaTableOptions {
  by: DimensionInput;
  /** 有序条件值，首个是基准；长度 ≥ 2。 */
  conditions: readonly [string, string, ...string[]] | { flag: string; baseline?: JsonValue };
  evals?: string | readonly string[];
}

function deltaTableData(
  input: ReportInput,
  options: DeltaTableOptions,
): Promise<DeltaData>;

type DeltaTableProps = ComponentProps<DeltaData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

`<Condition>` 与 `<FlagConditions>` 不混用；同时出现、`<Condition>` 少于两个、没有或多于一个 `baseline`、`value` 重复，都按完整用户反馈报错。列顺序是基准在前、其余按声明顺序。

`<FlagConditions>` 的派生规则是确定的：

- **条件域**：input 中 `<Columns dimension>` 的全部取值（如全部 experiment）。收窄后的取值必须在删除该 flag 后[可比性配置](../../results/library.md#官方现刻水位resultscurrent)深相等——它们是同一组配置的不同 flag 取值，不是互不相关的两批实验；不满足时计算以完整用户反馈报错，提示按 `evals` 或输入范围收窄成单一组。
- **基准与候选**：基准取 `baseline` 声明的 flag 值，省略为「未声明该 flag」；候选是该 flag 每个其它取值各一个条件，按显示键字典序排在基准之后。
- **0 候选不是错误**：收窄后配不出任何候选时显示明确空态并报告「N 个实验、0 个可配对条件」；维度不是 `"experiment"` 时按完整用户反馈报错。

两种形态共同的聚合行为：

- **配对身份是 eval id**：同一 eval id 在各条件下的结果进同一行；`evals` 与 CLI 位置参数同语义收窄行集。
- **单格折叠**：每个 cell 是该条件值 × eval 的折叠——`verdict` / `totalScore` 用与榜单同一套题目级判定口径，`totalTokens` / `totalCostUSD` 是该题在该条件下全部 attempt 的合计。同一条件值对应多个 experiment / snapshot 时（维度不是 `"experiment"`，或现刻水位由多个贡献快照撑起），cell 仍按这份折叠规则合并该组合下的全部 attempt。
- **翻转标记**：`flipped` 只在该行各条件判定不一致时为 true，供渲染面叠加 `⇄`；全部一致的行不加噪声。
- **占位与时效**：某条件没有该 eval 的结果时 `cells` 无该条件的键，渲染面显示占位 `—`，该题不计入该条件在 `totals` 里的分母；`historical` 为 true 的格来自跨快照携带的历史执行，渲染面叠加 `↩ <时距>`，与[实体列表的时效标注](entity-lists.md#时效标注)同一条呈现规则。
- **混型分段**：eval 集横跨通过制与计分制时，`totals[condition].scoringComposition` 为 `"mixed"`——通过制子集报 `passed / denominator`，计分制子集报 `totalScore`，两制不压成一个综合分；`totalTokens` / `totalCostUSD` 不分制，在该条件全部有结果的题上合计。
- **共同题 paired delta**：`pairedDelta[condition]` 只在该条件与基准都存在结果的 eval 交集（`commonEvalIds`）上计算——先在同一题上配对，再分别聚合判定与用量；`totals` 是各条件自身覆盖面的描述，两者分母不同，不能互相替代或拿来直接归因。`pass` / `points` 按共同题各自的题型分别给出，mixed 时两者都出现。
- **方向**：`score` 越高越好，`tokens` / `costUSD` 越低越好，符号由此固定；组件只呈现带符号差值，不替读者下结论。

行按 eval id 字典序排列；空 `rows` 两面零输出。web 面 `flipped` 为真的行叠加翻转标记，某条件的 `attempts` 非空且传了 `attemptHref` 时对应格可点开跳到对应 attempt 页，长度大于 1 时格内标 `×N`。text 面按同一份行序展开，条件按列顺序分组列出。

## `StabilityMatrix`

一张历史全执行的稳定性矩阵：行是 eval，列是 `<Columns>` 维度上的取值（通常是 experiment），格是该组合**全部历史执行**（跨快照按[身份键](../../results/library.md#身份键与去重)去重、不设可比性门槛）的判定计数。它回答「这道题在这个条件下历史上稳不稳」，不是现刻水位下「现在算不算过」——分工上与消费 Scope 现刻水位的 `MetricMatrix` 不同：`MetricMatrix` 的每个格是一次两级指标聚合，服务发布用的可比读数；`StabilityMatrix` 的每个格是原始计数，服务「哪些题从来没通过过」这类题目质量诊断，覆盖 `--fresh` 收窄之外的全部历史。终端 [`--stats`](../show/stats.md) 是这个组件的一处零配置装配。

因为它消费的是历史全执行而非现刻水位，组合组件应从 `ctx.results` 显式选择要统计的 `Snapshot[]` 传入 `input`；宿主注入的默认 Scope 已经过现刻水位收窄，不是完整历史（见 [Architecture · Scope 是计算入口](../architecture.md#scope-是计算入口)）。

```tsx
<StabilityMatrix evals="coding/">
  <Columns dimension="experiment" />
</StabilityMatrix>
```

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
  evals?: string | readonly string[];
}

function stabilityMatrixData(
  input: ReportInput,
  options?: StabilityMatrixOptions,
): Promise<StabilityMatrixData>;

type StabilityMatrixProps = ComponentProps<StabilityMatrixData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

行按历史最高通过率升序排列，零通过的题排最前——它们是题目质量审查的第一队列；同序值再按 `evalId` 字典序收口。格内三计数固定顺序 `✓ ✗ !`：`✗`（failed）与 `!`（errored）永远分列——判定失败是题目 / agent 的事实，基础设施错误是环境的事实，混进同一列会把环境事故误判成题目难度；`skipped` 不计入任何列。`totals` 给每列的三计数合计；某列的 `!` 合计异常高指向环境事故（限流、配额），矩阵只陈列计数，不替读者下结论。空 `rows` 两面零输出。

## 两面

`MetricTable`、`MetricMatrix`、`Scoreboard` 与 `DeltaTable` 的 text 面建在 [`Table`](../library/layout.md#table) 原语上：自定义表和官方表用同一把尺子，列宽按显示宽度计算，身份列压不到不可读。web 面是带列头的 `<table>`，排序与过滤是渐进增强。

## 相关阅读

- [组件树](README.md) —— 结构节点规则与共用呈现 props。
- [图表](charts.md) —— 同一份指标的图形投影。
- [指标与维度](../library/metrics.md) —— Metric、Dimension 与聚合口径。
- [实体列表](entity-lists.md) —— 从聚合下钻到逐实体事实。
</content>
