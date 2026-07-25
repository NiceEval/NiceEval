# `StabilityMatrix`

一张历史全执行的稳定性矩阵：行是 eval，列是 `<Columns>` 维度上的取值（通常是 experiment），格是该组合**全部历史执行**（跨快照按[身份键](../../../results/library.md#身份键与去重)去重、不设可比性门槛）的判定计数。它回答「这道题在这个条件下历史上稳不稳」，不是现刻水位下「现在算不算过」——分工上与消费 Scope 现刻水位的 `MetricMatrix` 不同：`MetricMatrix` 的每个格是一次两级指标聚合，服务发布用的可比读数；`StabilityMatrix` 的每个格是原始计数，服务「哪些题从来没通过过」这类题目质量诊断，覆盖 `--fresh` 收窄之外的全部历史。终端 [`--stats`](../../show/stats.md) 是这个组件的一处零配置装配。共用数据形状与维度绑定节点见[表格与矩阵](README.md)。

因为它消费的是历史全执行而非现刻水位，组合组件应从 `ctx.results` 显式选择要统计的 `Snapshot[]` 传入 `input`；宿主注入的默认 Scope 已经过现刻水位收窄，不是完整历史（见 [Architecture · Scope 是计算入口](../../architecture.md#scope-是计算入口)）。

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

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`MetricTable`](metric-table.md) / [`MetricMatrix`](metric-matrix.md) / [`Scoreboard`](scoreboard.md) / [`DeltaTable`](delta-table.md) —— 其它表格与矩阵。
