# `SampleSummary`

`SampleSummary` 是 NiceEval 默认报告对 Sample 的一种阅读方式，不是 Source。它选择首页要展示的范围、
判定构成、主读数和成本；这些选择是产品意见，不进入 `sources.sample.snapshot`。

事实来自两处：

- `sources.sample.snapshot` 提供 scope、题型构成、verdicts、coverage 与 provenance；
- `sources.measure.rows({ dimensions: [], measures })` 只计算本次摘要选择的 Measure。

默认可见短标签是 `Pass rate / 通过率`、`Total score / 总分`、`Experiments / 实验`、
`Evals / Eval`、`Attempts / Attempt` 与 `Total cost / 总成本`。时间按 locale 格式化到分钟；成本覆盖
不全时明确写出 `63/72 次有成本数据`，不只放无语义角标——这句覆盖解释由
[`Stat` 的 measure 格渲染契约](../primitives/stat-grid.md#渲染)承担，不是本组件的私有逻辑。

主读数按 `snapshot.scoringComposition` 选择：

- `"pass"`：只展示 `passRate`；
- `"points"`：只展示 `totalScore`；
- `"mixed"`：两者并排，各自保持自己的适用范围。

```ts
interface SampleSummaryProps {
  input?: Sample;
  /** 默认显示按 experimentId + evalId 折叠后的 verdict；也可查看 attempt 原始构成。 */
  votes?: "eval" | "attempt";
  locale?: ReportLocale;
  className?: string;
}
```

它由组合层实现，因为一次装配需要多个 Source。标签与格的摆放是装配，直接写在全文里，
不藏进私有 helper：

```tsx
const KPI_LABELS: Record<string, LocalizedText> = {
  passRate: { en: "Pass rate", "zh-CN": "通过率" },
  totalScore: { en: "Total score", "zh-CN": "总分" },
  costUSD: { en: "Total cost", "zh-CN": "总成本" },
};

export const SampleSummary = defineComposition(async (props, ctx) => {
  const input = props.input ?? ctx.input;
  const snapshot = await ctx.resolve(sources.sample.snapshot, input);
  const measures = snapshot.scoringComposition === "pass"
    ? [passRate, costUSD]
    : snapshot.scoringComposition === "points"
      ? [totalScore, costUSD]
      : [passRate, totalScore, costUSD];
  const summaryRows = sources.measure.rows({ dimensions: [], measures });
  const kpi = (await ctx.resolve(summaryRows, input)).rows[0];
  const verdicts = snapshot.verdicts[props.votes ?? "eval"];

  return (
    <Grid columns={4} locale={props.locale} className={props.className}>
      <Stat label={{ en: "Experiments", "zh-CN": "实验" }} value={snapshot.scope.experiments} />
      <Stat label={{ en: "Evals", "zh-CN": "Eval" }} value={snapshot.scope.evals} />
      <Stat label={{ en: "Attempts", "zh-CN": "Attempt" }} value={snapshot.scope.attempts} />
      {measures.map((measure) => (
        <Stat
          key={measure.name}
          label={KPI_LABELS[measure.name]}
          value={{ kind: "measure", measure: kpi.values[measure.name] as MeasureCell }}
        />
      ))}
      {(["passed", "failed", "errored", "skipped"] as const).map((verdict) => (
        <Stat key={verdict} label={verdict} value={verdicts[verdict]} />
      ))}
    </Grid>
  );
});
```

```tsx
<SampleSummary />
<SampleSummary votes="attempt" />
```

想选择另一组 KPI 时，不给 `SampleSummary` 增加任意字段开关；直接计算 snapshot 与所需 Measure，
再用 `Grid` / `Stat` 装自己的摘要。外部 React 页面同样先计算 Content，再走组件的 `data` 形态。

## 相关阅读

- [Source · Snapshot](../sources/README.md#snapshot) —— 中性的 SampleSnapshot / AttemptSnapshot。
- [`Grid` 与 `Stat`](../primitives/stat-grid.md) —— measure 格的覆盖解释与渲染契约。
- [`SampleOverview`](sample-overview.md) —— 默认首页如何装配摘要、图表与实体表。
- [读数与维度](../../library/measures.md) —— `passRate`、诊断率与按需 Dataset。
