# `sources.measure.stability`

`sources.measure.stability(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：每行是一道 eval，每个
条件格统计该组合的全部历史执行。它回答「这道题在这个条件下历史上稳不稳」，不是当前 Sample 下
「现在算不算过」。终端 [`--stats`](../../show/stats.md) 复用同一数据源。

这项计算消费宿主默认注入的 Sample，并从 `sample.historyAttempts` 读取作用域内完整历史：

```tsx
return (
  <Table
    source={sources.measure.stability({ columns: "experiment", evals: "coding/" })}
  />
);
```

```ts
interface StabilityCell {
  passed: number;
  failed: number;
  errored: number;
  /** passed + failed + errored；skipped 不计。 */
  executions: number;
}

interface StabilityRow extends Row {
  evalId: string;
  /** 全部条件历史执行中通过次数为 0 且执行数 > 0。 */
  neverPassed: boolean;
  cells: Readonly<Record<string, {
    kind: "verdict";
    counts: VerdictCounts;
  }>>;
}

interface StabilityContent extends TableContent<StabilityRow> {
  rowDimension: "eval";
  columnDimension: string;
  rows: StabilityRow[];
  totals: Record<string, StabilityCell>;
}

interface StabilityRowsOptions {
  columns: DimensionInput;
  evals?: string | readonly string[];
}

function stability(
  options: StabilityRowsOptions,
): Source<Sample, StabilityContent>;
```

计算跨 Run 按[身份键](../../../record/library.md#身份键与去重)去重，不设 Sample 可比性门槛，也不受
`--fresh` 限制。行按历史最高通过率升序，零通过的题排最前；同值再按 `evalId` 字典序收口。
格内计数固定分成 passed、failed、errored，避免把环境事故误判成题目难度；`skipped` 不进入执行数。
矩阵只陈列计数，不替读者下结论。

`evals` 属于 Source options；`attemptHref`、`locale`、`className` 属于 Table。手工计算写
`await sources.measure.stability(options).compute(sample)`。

## 相关阅读

- [Measure 数据源](measure.md) —— 共用数据形状与两面规则。
- [`sources.measure.rows`](measure-rows.md) / [`sources.measure.matrix`](measure-matrix.md) /
  [`sources.measure.scoreboard`](measure-scoreboard.md) /
  [`sources.measure.delta`](measure-delta.md) —— 其它表格数据源。
