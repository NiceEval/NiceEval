# `scoreboard`

`scoreboard(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源。它接收一份显式固定题集，
再把每个行维度在每道题上的分数折成总分和分组得分。数据源不从已观测 attempt 的并集猜题集，因此
「所有配置都没跑到的题」仍留在分母中并按 0 分计。

配置是普通可序列化数据，不是一棵专用 JSX 子树：

```tsx
const securityScore = scoreboard({
  rows: "agent",
  fullMarks: 100,
  score: examScore,
  groups: [
    {
      name: "security",
      weight: 3,
      evals: ["security/sql-injection", "security/path-traversal"],
    },
    {
      name: "correctness",
      weight: 2,
      evals: ["correctness/retry"],
    },
  ],
});

<Table source={securityScore} />
```

每道题需要不同权重时，使用展开形态：

```ts
const score = scoreboard({
  rows: "agent",
  questions: [
    { evalId: "security/sql-injection", group: "security", weight: 3 },
    { evalId: "security/path-traversal", group: "security", weight: 2 },
    { evalId: "correctness/retry", group: "correctness", weight: 1 },
  ],
});
```

`groups` 是批量声明同权重题目的便利形态，`questions` 是规范形态；二者不能同时出现。

```ts
interface ScoreGroup {
  name: string;
  evals: readonly [string, ...string[]];
  /** 组内每道题的权重；省略为 1。 */
  weight?: number;
}

interface ScoreQuestion {
  evalId: string;
  group?: string;
  /** 该题权重；省略为 1。 */
  weight?: number;
}

type ScoreboardOptions = {
  rows: DimensionInput;
  fullMarks?: number;
  score?: Measure;
} & (
  | { groups: readonly [ScoreGroup, ...ScoreGroup[]]; questions?: never }
  | { questions: readonly [ScoreQuestion, ...ScoreQuestion[]]; groups?: never }
);

function scoreboard(
  options: ScoreboardOptions,
): DataSource<ScoreboardContent>;
```

```ts
interface ScoreboardContent {
  rowDimension: string;
  questions: string[];
  fullMarks: number;
  /** 逐题解析后的权重，按题集声明顺序。 */
  weights: Array<{ evalId: string; group: string; weight: number }>;
  ignoredEvals: number;
  rows: Array<{
    key: string;
    total: {
      /** fullMarks × earned / possible。 */
      value: number;
      display: LocalizedText;
      notRun: number;
      unscorable: number;
      refs: AttemptLocator[];
    };
    groups: Array<{
      key: string;
      earned: number;
      possible: number;
      questions: number;
      notRun: number;
      unscorable: number;
      display: LocalizedText;
      refs: AttemptLocator[];
    }>;
  }>;
}
```

`score` 默认 `examScore`，每道题必须产出 `[0, 1]`。读数为 `null`（跑了但测不了）与完全未运行都按
该题 0 分，但分别计入 `unscorable` 与 `notRun`。题目得分乘各自权重；总分是
`fullMarks × earned / possible`，`fullMarks` 默认 100。

Sample 中存在题集之外的 eval 时，数据源忽略它们，把数量写进 `ignoredEvals`。eval id 重复、
空组、空组名、`fullMarks <= 0`、非正或非有限权重，或 score 超出 `[0, 1]` 时，
`compute()` 以完整用户反馈失败。`evals` 不作为 source 选项开放：固定题集本身就是这项计算的分母。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状与两面规则。
- [`measureRows`](measure-table.md) / [`measureMatrix`](measure-matrix.md) /
  [`deltaRows`](delta-table.md) / [`stabilityRows`](stability-matrix.md) —— 其它表格数据源。
