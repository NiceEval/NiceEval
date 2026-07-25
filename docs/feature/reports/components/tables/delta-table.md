# `DeltaTable`

把同一批 eval 在一组有序条件下的对照展开成表：每行是一道 eval，每组列是一个条件。`<Columns>` 声明条件取值所在的维度，它的 `<Condition>` 子节点逐个写下该维度上的取值，其中恰好一个标 `baseline`——`"baseline"` 因此不会被猜成 experiment、agent、flag 或 Run 中的某一种。行维度恒为 eval，没有 `<Rows>`。共用数据形状、维度绑定节点与两面规则见[表格与矩阵](README.md)。

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

终端里多个 `--exp` 的[对照矩阵](../../show/compare.md)是这个组件的一处零配置装配——同一批题在终端与报告页得到相同的行、相同的数字。

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
      /** true 时该格来自跨 Run 携带的历史执行，渲染为 ↩ 时效标注。 */
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

- **条件域**：input 中 `<Columns dimension>` 的全部取值（如全部 experiment）。收窄后的取值必须在删除该 flag 后[可比性配置](../../../sample/library.md#两个选择器)深相等——它们是同一组配置的不同 flag 取值，不是互不相关的两批实验；不满足时计算以完整用户反馈报错，提示按 `evals` 或输入范围收窄成单一组。
- **基准与候选**：基准取 `baseline` 声明的 flag 值，省略为「未声明该 flag」；候选是该 flag 每个其它取值各一个条件，按显示键字典序排在基准之后。
- **0 候选不是错误**：收窄后配不出任何候选时显示明确空态并报告「N 个实验、0 个可配对条件」；维度不是 `"experiment"` 时按完整用户反馈报错。

两种形态共同的聚合行为：

- **配对身份是 eval id**：同一 eval id 在各条件下的结果进同一行；`evals` 与 CLI 位置参数同语义收窄行集。
- **单格折叠**：每个 cell 是该条件值 × eval 的折叠——`verdict` / `totalScore` 用与榜单同一套题目级判定口径，`totalTokens` / `totalCostUSD` 是该题在该条件下全部 attempt 的合计。同一条件值对应多个 experiment / Run 时（维度不是 `"experiment"`，或现刻水位由多个贡献 Run 撑起），cell 仍按这份折叠规则合并该组合下的全部 attempt。
- **翻转标记**：`flipped` 只在该行各条件判定不一致时为 true，供渲染面叠加 `⇄`；全部一致的行不加噪声。
- **占位与时效**：某条件没有该 eval 的结果时 `cells` 无该条件的键，渲染面显示占位 `—`，该题不计入该条件在 `totals` 里的分母；`historical` 为 true 的格来自跨 Run 携带的历史执行，渲染面叠加 `↩ <时距>`，与[实体列表的时效标注](../entity-lists/README.md#时效标注)同一条呈现规则。
- **混型分段**：eval 集横跨通过制与计分制时，`totals[condition].scoringComposition` 为 `"mixed"`——通过制子集报 `passed / denominator`，计分制子集报 `totalScore`，两制不压成一个综合分；`totalTokens` / `totalCostUSD` 不分制，在该条件全部有结果的题上合计。
- **共同题 paired delta**：`pairedDelta[condition]` 只在该条件与基准都存在结果的 eval 交集（`commonEvalIds`）上计算——先在同一题上配对，再分别聚合判定与用量；`totals` 是各条件自身覆盖面的描述，两者分母不同，不能互相替代或拿来直接归因。`pass` / `points` 按共同题各自的题型分别给出，mixed 时两者都出现。
- **方向**：`score` 越高越好，`tokens` / `costUSD` 越低越好，符号由此固定；组件只呈现带符号差值，不替读者下结论。

行按 eval id 字典序排列；空 `rows` 两面零输出。web 面 `flipped` 为真的行叠加翻转标记，某条件的 `attempts` 非空且传了 `attemptHref` 时对应格可点开跳到对应 attempt 页，长度大于 1 时格内标 `×N`。text 面按同一份行序展开，条件按列顺序分组列出。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`MetricTable`](metric-table.md) / [`MetricMatrix`](metric-matrix.md) / [`Scoreboard`](scoreboard.md) / [`StabilityMatrix`](stability-matrix.md) —— 其它表格与矩阵。
