# `stabilityRows`

`stabilityRows(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：每行是一道 eval，每个
条件格统计该组合的全部历史执行。它回答「这道题在这个条件下历史上稳不稳」，不是当前 Sample 下
「现在算不算过」。终端 [`--stats`](../../show/stats.md) 复用同一数据源。

这项计算消费 `Run[]`，不消费宿主默认注入的 Sample。组合组件从 `ctx.record` 显式选择完整历史，
再把它作为 `input` 传入：

```tsx
const history = await ctx.record.runs();

return (
  <Table
    source={stabilityRows({ columns: "experiment" })}
    input={history}
    evals="coding/"
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
}

interface StabilityContent {
  rowDimension: "eval";
  columnDimension: string;
  rows: StabilityRow[];
  columns: readonly string[];
  /** 稀疏格子；没有历史执行的组合不生成格子。 */
  cells: ReadonlyArray<{ row: string; column: string; cell: StabilityCell }>;
  totals: Record<string, StabilityCell>;
}

interface StabilityRowsOptions {
  columns: DimensionInput;
}

function stabilityRows(
  options: StabilityRowsOptions,
): DataSource<StabilityContent, readonly Run[]>;
```

计算跨 Run 按[身份键](../../../record/library.md#身份键与去重)去重，不设 Sample 可比性门槛，也不受
`--fresh` 限制。行按历史最高通过率升序，零通过的题排最前；同值再按 `evalId` 字典序收口。
格内计数固定分成 passed、failed、errored，避免把环境事故误判成题目难度；`skipped` 不进入执行数。
矩阵只陈列计数，不替读者下结论。

`evals`、`attemptHref`、`locale`、`className` 属于 `Table`。手工计算写
`await stabilityRows(options).compute(runs)`。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状与两面规则。
- [`measureRows`](measure-table.md) / [`measureMatrix`](measure-matrix.md) /
  [`scoreboard`](scoreboard.md) / [`deltaRows`](delta-table.md) —— 其它表格数据源。
