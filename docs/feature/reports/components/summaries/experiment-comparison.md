# `ExperimentComparison`

裸 `niceeval show` 与 `niceeval view` 首页经由[内建报告](../../library/built-in.md)渲染的默认组合件。它把同一个 `input` 显式传给三个叶子组件；每个叶子按自己的公开契约取数，组合件不合并结果、不缓存第二份 data，共享计算由报告 resolve 的「同引用 input + 深相等 spec」记忆化保证。

Scope 内任一实验声明了 [`labels`](../../../experiments/library.md#labels声明归类坐标不进运行时) 的 `line` 键，散点就按 `label("line")` 归类并连线；否则按 `"agent"` 归类、不连线。显式传 `by` / `line` 时采用显式值，`line` 与 [`Scatter`](../charts/scatter-chart.md#scatter) 同一契约。

主读数与归类维度一样在 compose 阶段解析，判据是[主读数映射](../../library/metrics.md#题型构成与主读数)单点规则：`scoringComposition(input)` 为 `"pass"` 时散点 y 轴与列表预排序用 `endToEndPassRate`；`"points"` 时全部换成 `totalScore`；`"mixed"` 时按题型把 input 拆成两个子 Scope，散点与 `ExperimentList` 每组各一份、各用各的主读数——[计分粒度](../../../experiments/score-points.md#横截面聚合同型实验各读各的)「两类都要跑就报告并排两个实验组」的落点就在这里。`ScopeSummary` 始终是整个 input 一份：它的 data 自带 `scoringComposition`，混型时两个主 KPI 都显示。

端到端通过率对同一 experiment × eval 的多轮 attempt 先求均值，再跨 experiment × eval 求均值；`failed` 与 `errored` 为 0，`skipped` 为 `null`。摘要中的 verdict 构成另按 Eval 最终 verdict 计票：任一轮 passed 则 Eval passed，否则按 `failed > errored > skipped` 折叠。

web 与 text 两面都输出当前 Scope 的摘要、散点和实验列表，不设组索引或组选择器；这是三个叶子组件各自双面输出后按 `Col` 排列的结果，不是 `ExperimentComparison` 自己实现第三套 renderer。

```ts
interface ExperimentComparisonProps {
  input?: ReportInput;
  /** 散点的 series 维度。缺省:有 label `line` 声明 → label("line") 并连线;否则 "agent"、不连线。 */
  by?: DimensionInput;
  /** 透传给散点；契约同 Scatter 的 line。 */
  line?: boolean;
  locale?: ReportLocale;
  className?: string;
}
```

```tsx
<ExperimentComparison />
<ExperimentComparison by={label("line")} line />
```

Experiment 按主读数从高到低预排（通过制按通过率，计分制按总分）。要比较某个子集，先用宿主的 `--exp` 收窄，或在自定义报告里显式 `filter`。

它不接受结构子节点：要改这份装配就不用它，直接写下面这棵树并逐块增删（示例是单一题型的形态；`"mixed"` 时按题型拆成两个子 Scope，散点与列表每组一份）。

```tsx
export const ExperimentComparison = defineComponent(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const { by, line } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);
  const primary = composition === "points" ? totalScore : endToEndPassRate;
  return (
    <Col className={props.className}>
      <ScopeSummary input={input} locale={props.locale} />
      <ScatterChart input={input} locale={props.locale}>
        <XAxis metric={costUSD} />
        <YAxis metric={primary} />
        <Tooltip />
        <Legend />
        <Scatter points="experiment" by={by} x={costUSD} y={primary} line={line} />
      </ScatterChart>
      <ExperimentList input={input} filter locale={props.locale} />
    </Col>
  );
});
```

实验列表的行标签默认缩成 experiment id 在当前 Scope 里的最短唯一后缀（与[散点点标签](../charts/README.md#两面投影)同一算法）；完整 id 始终是排序、过滤与展开折叠的身份键，也仍是 `ScopeSummary` 与散点内部计算的依据。同一个 agent 在散点图例和列表里同色，由[页级色分配](../README.md#系列色分配单位是页)保证。

`ExperimentComparison` 只从 `niceeval/report` 导出，不从 `niceeval/report/react` 导出；自有 React 页面分别计算并组合三个叶子组件的 data。

## 相关阅读

- [概览](README.md) —— `ScopeSummary` 与本组件的关系。
- [`ScopeSummary`](scope-summary.md) —— 三个叶子组件之一。
