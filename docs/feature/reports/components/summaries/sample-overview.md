# `SampleOverview`

裸 `niceeval show` 与 `niceeval view` 首页经由[内建报告](../../library/built-in.md)渲染的默认组合组件。
它回答“这份 Sample 整体怎样”，把同一个 `input` 传给摘要、质量成本图与 Experiment 层级行。
即使范围里只有一个 Experiment，这个问题仍然成立。

Sample 内任一实验声明了 [`labels`](../../../experiments/library.md#labels声明归类坐标不进运行时)
的 `line` 键，散点就按 `label("line")` 归类并连线；否则按 `"agent"` 归类、不连线。

主读数与归类维度一样在 compose 阶段解析：

- `"pass"`：图表 y 轴与 Experiment 行预排序使用 `endToEndPassRate`。
- `"points"`：两处都改用 `totalScore`。
- `"mixed"`：按题型拆成两个子 Sample，每组各生成图表和 `experimentRows`。

`scoringComposition(input)` 给出上述分类。完整判据见
[主读数映射](../../library/measures.md#题型构成与主读数)。

端到端通过率先聚合同一 experiment × eval 的 attempts，再跨题聚合。
`failed` 与 `errored` 为 0，`skipped` 为 `null`。

摘要中的 verdict 构成按 Eval 最终 verdict 计票。任一轮 passed 则 Eval passed；
否则按 `failed > errored > skipped` 折叠。

web 与 text 两面都输出当前 Sample 的摘要、散点和 Experiment 层级行，不设组索引或组选择器。
组合组件只装配公开原语与数据源，不实现第三套 renderer。

```ts
interface SampleOverviewProps {
  input?: ReportInput;
  /** 图表的 series 维度；缺省由 label("line") 或 agent 决定。 */
  by?: DimensionInput;
  /** 是否连接同一 series 内按 x 排序的散点。 */
  line?: boolean;
  locale?: ReportLocale;
  className?: string;
}
```

```tsx
<SampleOverview />
<SampleOverview by={label("line")} line />
```

Experiment 按主读数从高到低预排：通过制按通过率，计分制按总分。
比较子集时先用宿主的 `--exp` 收窄，或在自定义报告里显式 `filter`。

它不接受结构子节点。要改装配就直接写下面这棵树并逐块增删。
示例是单一题型；`"mixed"` 时按题型拆成两个子 Sample，每组各有图表与实体行。

```tsx
export const SampleOverview = defineComponent(async (props, ctx) => {
  const input = props.input ?? ctx.sample;
  const { by, line } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);
  const primary = composition === "points" ? totalScore : endToEndPassRate;
  const frontier = chart({
    x: { measure: costUSD },
    y: { measure: primary },
    series: [{
      key: "frontier",
      mark: "scatter",
      points: "experiment",
      by,
      x: costUSD,
      y: primary,
      connect: line,
    }],
  });
  return (
    <Col className={props.className}>
      <Grid source={sampleSummary()} input={input} locale={props.locale} />
      <Chart source={frontier} input={input} locale={props.locale} legend tooltip />
      <Table source={experimentRows} input={input} filter locale={props.locale} />
    </Col>
  );
});
```

Experiment 行标签默认缩成 id 在当前 Sample 里的最短唯一后缀,完整 id 仍是排序、过滤与展开的
身份键。同一个 agent 在散点图例和表格里同色,由[页级色分配](../README.md#系列色分配单位是页)
保证。

`SampleOverview` 只从 `niceeval/report` 导出,不从 `niceeval/report/react` 导出。自有 React 页面
分别计算数据源并组合纯原语。

## 相关阅读

- [概览](README.md) —— `sampleSummary` 与本组合组件的关系。
- [`sampleSummary`](sample-summary.md) —— 摘要数据源。
