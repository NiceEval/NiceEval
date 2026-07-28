# `sources.measure.delta`

`sources.measure.delta(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：每行是一道 eval，每组列是
一个条件。`by` 明确条件取值所在的维度，`conditions` 明确有序条件与基准，因此 `"baseline"`
不会被猜成 experiment、agent、flag 或 Run 中的某一种。

```tsx
<Table
  source={sources.measure.delta({
    by: "experiment",
    conditions: [
      { value: "compare/baseline", baseline: true },
      { value: "compare/with-memory" },
    ],
  })}
/>
```

实验矩阵是「同配置开关某个 flag」时，条件关系可由 experiment 配置推导：

```tsx
<Table
  source={sources.measure.delta({
    by: "experiment",
    conditions: { flag: "memory" },
  })}
/>
```

终端里多个 `--exp` 的[对照矩阵](../../show/compare.md)复用同一数据源，同一批题在终端与报告页得到
相同的行和数字。

```ts
interface DeltaCondition {
  /** 取自 by 维度的精确值；不做前缀或模糊匹配。 */
  value: string;
  /** 基准条件；数组中恰好一个。 */
  baseline?: boolean;
}

interface FlagConditions {
  flag: string;
  /** 基准侧的 flag 取值；省略表示未声明该 flag。 */
  baseline?: JsonValue;
}

interface DeltaRowsOptions {
  by: DimensionInput;
  evals?: string | readonly string[];
  conditions:
    | readonly [DeltaCondition, DeltaCondition, ...DeltaCondition[]]
    | FlagConditions;
}

function delta(
  options: DeltaRowsOptions,
): Source<Sample, DeltaContent>;
```

```ts
interface DeltaContent extends TableContent<DeltaRow> {
  byDimension: string;
  /** 有序条件值，首个是基准。 */
  conditions: string[];
  experiments?: number;
  rows: DeltaRow[];
  totals: Record<string, {
    scoringComposition: "pass" | "points" | "mixed";
    passed?: number;
    denominator?: number;
    totalScore?: number;
    totalTokens?: number;
    totalCostUSD?: number;
  }>;
  pairedDelta: Record<string, {
    commonEvalIds: string[];
    pass?: { evalIds: string[]; passRatePoints: number };
    points?: { evalIds: string[]; totalScore: number };
    tokens?: number;
    costUSD?: number;
  }>;
}

interface DeltaRow extends Row {
  /** 配对身份：eval id。 */
  key: string;
  flipped: boolean;
  cells: Readonly<Record<string, Cell>>;
  conditions: Record<string, {
    scoring: "pass" | "points";
    verdict: AttemptRecord["verdict"];
    totalScore?: number;
    attempts: readonly AttemptLocator[];
    totalTokens?: number;
    totalCostUSD?: number;
    historical: boolean;
  }>;
  /** 任一侧缺数据时无键；delta 不把缺失当 0。 */
  delta?: Record<string, { score?: number; tokens?: number; costUSD?: number }>;
}
```

字面条件不能少于两个，必须恰好一个 `baseline`，且 `value` 不得重复。flag 形态只允许
`by: "experiment"`；候选 experiment 删除该 flag 后的
[可比性配置](../../../sample/library.md#两个选择器)必须深相等。派生不出候选不是错误，Content 明确
记录「N 个实验、0 个可配对条件」的空态。

配对身份恒为 eval id。每格先按默认报告的题目级判定口径折叠，`pairedDelta` 再只在该条件与基准
都存在结果的 eval 交集上计算。通过制与计分制混合时分别汇总，不压成一个综合分。`score` 越高越好，
`tokens` 与 `costUSD` 越低越好；数据源只计算带符号差值，不替读者下结论。

`evals` 属于 Source options。手工计算写 `await sources.measure.delta(options).compute(input)`。

## 相关阅读

- [Measure 数据源](measure.md) —— 共用数据形状与两面规则。
- [`sources.measure.rows`](measure-rows.md) / [`sources.measure.matrix`](measure-matrix.md) /
  [`sources.measure.scoreboard`](measure-scoreboard.md) /
  [`sources.measure.stability`](measure-stability.md) —— 其它表格数据源。
