# `StabilityOverview`

`StabilityOverview` 回答「这套题历史上稳不稳」，是官方 `stability` 视图的主体区块
（[视图全文](../../library/built-in.md#任务视图failures-与-stability)）。它 resolve
[`sources.measure.stability`](../sources/measure-stability.md) 一次，
其余全部是对 `StabilityContent` 的字面投影——散点与堆叠柱走 `Chart` 的 data 形态，
不新增任何聚合口径。

四个区块自上而下：

| 区块 | 回答什么 | 形态 |
|---|---|---|
| 读数格 | 历史执行总量、零通过题数、闪烁题数 | `Grid` / `Stat` |
| 稳定性散点 | 哪些题在闪烁、哪些从没过过 | scatter：x = 执行次数，y = 历史通过率，一点一格 |
| 判定构成堆叠柱 | 失败是题难还是环境事故 | bar + `stack`：一条件一柱，passed / failed / errored 三段 |
| 稳定性矩阵 | 逐题 × 逐条件下钻 | `Table`，与 [`show --stats`](../../show/stats.md) 同一数据源 |

散点上 y = 0 的一排就是从没通过过的题；0 与 1 之间的点是闪烁题。「闪烁」的判据是任一条件格
`0 < passed < executions`，全过与全挂都不算。堆叠柱里 errored 段肥大的条件是基础设施问题，
不是题目难度。历史为空时矩阵与图表照常空态，读数格显示 0。

```ts
interface StabilityOverviewProps {
  input?: ReportInput;
  /** 条件维度；缺省 "experiment"，与 show --stats 相同。 */
  columns?: DimensionInput;
  /** 聚合前收窄题集；透传给 sources.measure.stability。 */
  evals?: string | readonly string[];
  locale?: ReportLocale;
  className?: string;
}
```

全文（投影是装配，直接写成字面代码）：

```tsx
export const StabilityOverview = defineComposition(async (props: StabilityOverviewProps, ctx) => {
  const input = props.input ?? ctx.input;
  const content = await ctx.resolve(
    sources.measure.stability({ columns: props.columns ?? "experiment", evals: props.evals }),
    input,
  );

  const points = content.rows.flatMap((row) =>
    Object.entries(row.cells).map(([condition, cell]) => {
      const n = cell.counts.passed + cell.counts.failed + cell.counts.errored;
      const measure = { samples: n, total: n, refs: [...cell.refs] };
      return {
        key: `${row.evalId} · ${condition}`,
        values: {
          eval: row.evalId,
          condition,
          executions: { value: n, ...measure },
          passRatio: {
            value: n === 0 ? null : cell.counts.passed / n,
            format: { style: "percent" },
            ...measure,
          },
        },
      };
    }),
  );
  const scatter = {
    fields: [
      { name: "eval", kind: "dimension", valueType: "string" },
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "executions", kind: "measure", valueType: "number" },
      {
        name: "passRatio",
        kind: "measure",
        valueType: "number",
        better: "higher",
        bounds: { min: 0, max: 1 },
        format: { style: "percent" },
      },
    ],
    rows: points,
  };

  const bars = {
    fields: [
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "passed", kind: "measure", valueType: "number" },
      { name: "failed", kind: "measure", valueType: "number" },
      { name: "errored", kind: "measure", valueType: "number" },
    ],
    rows: Object.entries(content.totals).map(([condition, totals]) => ({
      key: condition,
      values: {
        condition,
        passed: totals.passed,
        failed: totals.failed,
        errored: totals.errored,
      },
    })),
  };

  const flaky = content.rows.filter((row) =>
    Object.values(row.cells).some((cell) => {
      const n = cell.counts.passed + cell.counts.failed + cell.counts.errored;
      return cell.counts.passed > 0 && cell.counts.passed < n;
    }),
  ).length;
  const executions = Object.values(content.totals)
    .reduce((sum, totals) => sum + totals.executions, 0);
  const neverPassed = content.rows.filter((row) => row.neverPassed).length;

  return (
    <Col className={props.className}>
      <Grid columns={3} locale={props.locale}>
        <Stat label={{ en: "Executions", "zh-CN": "历史执行" }} value={executions} />
        <Stat label={{ en: "Never passed", "zh-CN": "零通过题" }} value={neverPassed} />
        <Stat label={{ en: "Flaky evals", "zh-CN": "闪烁题" }} value={flaky} />
      </Grid>
      <Chart data={scatter} x="executions" y="passRatio" legend tooltip locale={props.locale}>
        <Series id="stability" mark="scatter" points="eval" by="condition" />
      </Chart>
      <Chart data={bars} x="condition" legend tooltip locale={props.locale}>
        <Series id="passed" mark="bar" y="passed" stack="verdicts" />
        <Series id="failed" mark="bar" y="failed" stack="verdicts" />
        <Series id="errored" mark="bar" y="errored" stack="verdicts" />
      </Chart>
      <Table data={content} locale={props.locale} />
    </Col>
  );
});
```

散点点位与矩阵格共享同一份 `cell.refs`（[格子契约](../sources/measure-stability.md#数据形状)），
经 `attemptHref` 下钻到具体历史执行。`by="condition"` 的视觉身份走
[页级色分配](../README.md#维度呈现分配单位是页)，条件数超过 24 时按既有容量语义拒绝该页。
趋势折线（通过率随 Run 演化）不在本组件：它需要历史范围的 Sample 选择器配
`sources.measure.rows({ dimensions: ["run"] })`，不需要新的图表或数据源入口。

## 相关阅读

- [`sources.measure.stability`](../sources/measure-stability.md) —— 唯一被 resolve 的数据源。
- [图表](../charts/README.md) —— data 形态、`stack` 与轴语义。
- [内建报告](../../library/built-in.md#任务视图failures-与-stability) —— `stability` 视图全文。
- [Sample 页区块](README.md) —— 本组的其它区块。
