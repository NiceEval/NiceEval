# 概览

回答「这批结果有多大、整体是否健康、当前水位在哪」的两个层次：`ScopeSummary` 是有 `scopeSummaryData` 的叶子数据组件；`ExperimentComparison` 是内建首页使用的 report-only 组合组件，只把 `ScopeSummary`、一张成本 × 主读数散点和 `ExperimentList` 摆在一起，不发明自己的 data 形状或渲染面。

## `ExperimentComparison`

裸 `niceeval show` 与 `niceeval view` 首页经由[内建报告](../library/built-in.md)渲染的默认组合件。它把同一个 `input` 显式传给三个叶子组件；每个叶子按自己的公开契约取数，组合件不合并结果、不缓存第二份 data，共享计算由报告 resolve 的「同引用 input + 深相等 spec」记忆化保证。

Scope 内任一实验声明了 [`labels`](../../experiments/library.md#labels声明归类坐标不进运行时) 的 `line` 键，散点就按 `label("line")` 归类并连线；否则按 `"agent"` 归类、不连线。显式传 `by` / `line` 时采用显式值，`line` 与 [`Scatter`](charts.md#scatter) 同一契约。

主读数与归类维度一样在 compose 阶段解析，判据是[主读数映射](../library/metrics.md#题型构成与主读数)单点规则：`scoringComposition(input)` 为 `"pass"` 时散点 y 轴与列表预排序用 `endToEndPassRate`；`"points"` 时全部换成 `totalScore`；`"mixed"` 时按题型把 input 拆成两个子 Scope，散点与 `ExperimentList` 每组各一份、各用各的主读数——[计分粒度](../../experiments/score-points.md#横截面聚合同型实验各读各的)「两类都要跑就报告并排两个实验组」的落点就在这里。`ScopeSummary` 始终是整个 input 一份：它的 data 自带 `scoringComposition`，混型时两个主 KPI 都显示。

端到端通过率对同一 experiment × eval 的多轮 attempt 先求均值，再跨 experiment × eval 求均值；`failed` 与 `errored` 为 0，`skipped` 为 `null`。摘要中的 verdict 构成另按 Eval 最终 verdict 计票：任一轮 passed 则 Eval passed，否则按 `failed > errored > skipped` 折叠。

web 与 text 两面都输出当前 Scope 的摘要、散点和实验列表，不设组索引或组选择器；这是三个叶子组件各自双面输出后按 `Col` 排列的结果，不是 `ExperimentComparison` 自己实现第三套 renderer。

```ts
interface ExperimentComparisonProps {
  input?: ReportInput;
  /** 散点的 series 维度。缺省:有 label `line` 声明 → label("line") 并连线;否则 "agent"、不连线。 */
  by?: SeriesInput;
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

实验列表的行标签默认缩成 experiment id 在当前 Scope 里的最短唯一后缀（与[散点点标签](charts.md#两面投影)同一算法）；完整 id 始终是排序、过滤与展开折叠的身份键，也仍是 `ScopeSummary` 与散点内部计算的依据。同一个 agent 在散点图例和列表里同色，由[页级色分配](README.md#系列色分配单位是页)保证。

`ExperimentComparison` 只从 `niceeval/report` 导出，不从 `niceeval/report/react` 导出；自有 React 页面分别计算并组合三个叶子组件的 data。

## `ScopeSummary`

显示一个范围的快照时间窗、experiment / eval / attempt 数、两级判定结果、主读数（通过率或总分）和总成本。Eval 的身份键是 `experimentId + evalId`：同一个 Eval 在不同 experiment 中运行时算两个独立 Eval，`evals` 与 `evalVerdicts` 都按这个身份计数。

web 面使用短标签 `Pass rate / 通过率`、`Total score / 总分`、`Experiments / 实验`、`Evals / Eval`、`Attempts / Attempt`、`Eval results / Eval 结果`（`votes="attempt"` 时为 `Attempt results / Attempt 结果`）和 `Total cost / 总成本`。这些是字段名，不在标签里重复“数”“次”或“计票”；数量由值本身表达。时间不直接暴露 ISO 字符串：单点写成 `Last run / 最近运行`，范围写成 `Run range / 运行范围`，时间值按当前 locale 格式化到分钟；同日范围不重复右端日期，同年跨日范围不重复右端年份。成本覆盖不全时，在金额下方用 `Cost available for 63/72 attempts / 63/72 次有成本数据` 解释覆盖范围，不能只放一个无语义的 `63/72` 角标。

主读数按 Scope 内出现的题型（`scoringComposition`，判据与公开函数单点在[主读数映射](../library/metrics.md#题型构成与主读数)）切换：纯通过制（`"pass"`）只显示通过率，`totalScore` 省略；纯计分制（`"points"`）隐藏通过率、只显示总分（[`totalScore` 指标](../library/metrics.md#内置指标)：`assertions[].points` 之和加 `scoreEntries[].points` 之和，errored/skipped 记 `null`）；混型（`"mixed"`，一个 Scope 并排通过制与计分制两个 experiment，见[计分粒度](../../experiments/score-points.md)）两者都显示——不摆空列，只在相关时才出现对应的读数。

data 恒携带两级计票，两份序列化 JSON 摆在一起时口径自明；渲染面显示哪一级由呈现 prop `votes` 决定：

- `evalVerdicts`（`votes: "eval"`，默认）：每个 experimentId + evalId 先按「任一轮 passed 即 passed，否则 `failed > errored > skipped`」折成最终 verdict 后计票，回答「多少个 Eval 最终通过」。
- `attemptVerdicts`（`votes: "attempt"`）：attempt 原始计票，不折叠，回答「实际跑的每一轮各是什么结果」。

两级计票与 `endToEndPassRate` 互不反推：通过率来自官方两级指标引擎，渲染面不得从任一计票现场重算。Scope warning 与 Snapshot diagnostic 都不进 `ScopeSummaryData`：呈现件分别是 [`ScopeWarnings`](site.md#scopewarnings) 与 [`SnapshotDiagnostics`](site.md#snapshotdiagnostics)，摘要数据不复制它们的输入，同一份事实不在页面上出现两次。

```ts
interface ScopeSummaryData {
  /** 贡献当前数据的快照时间范围；空范围为 null，不编造当前时间。 */
  range: { earliestStartedAt: string | null; latestStartedAt: string | null };
  experiments: number;
  /** experimentId + evalId 的去重计数。 */
  evals: number;
  attempts: number;
  /** 每个 experimentId + evalId 先折成最终 verdict 后计票。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** attempt 原始计票，不折叠。 */
  attemptVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 官方两级 endToEndPassRate，不从任一计票重算。 */
  endToEndPassRate: MetricCell;
  /**
   * 该 Scope 内出现的题型：`"pass"` 全部通过制、`"points"` 全部计分制、`"mixed"` 两者都有
   * （一个 Scope 可以并排多个 experiment，题型只在单个 experiment 内被强制统一）。渲染面据此
   * 决定主 KPI：`"points"` 隐藏通过率只显示 `totalScore`；`"mixed"` 两者都显示；`"pass"` 只
   * 显示通过率、`totalScore` 省略。
   */
  scoringComposition: "pass" | "points" | "mixed";
  /** 计分制总分（`totalScore` 指标）。仅 `scoringComposition` 为 `"points"` 或 `"mixed"` 时出现。 */
  totalScore?: MetricCell;
  /** costUSD 按 attempt 求和；缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

function scopeSummaryData(input: ReportInput): Promise<ScopeSummaryData>;

type ScopeSummaryProps = ComponentProps<ScopeSummaryData, {
  /** 显示哪一级计票；默认 "eval"。data 恒携带两级，votes 只选择呈现。 */
  votes?: "eval" | "attempt";
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<ScopeSummary />                    // 当前 Scope 的摘要，eval 级计票
<ScopeSummary votes="attempt" />    // 同一份 data，改看 attempt 原始计票
```

字段集由 Scope 的题型构成决定，所以它没有结构子节点：作者能决定的是放不放它、看哪一级计票。收窄范围时在[组合组件](../library/layout.md#自定义组件)里显式传 `input`：

```tsx
const CompareSummary = defineComponent((_props: {}, ctx) => (
  <ScopeSummary input={ctx.scope.filter((s) => s.experimentId.startsWith("compare/"))} />
));
```

## 相关阅读

- [组件树](README.md) —— 组合组件为什么不收结构子节点。
- [实体列表](entity-lists.md) —— 从汇总下钻到 experiment / eval / attempt。
- [图表](charts.md) —— 散点与其它图形投影。
- [内建报告](../library/built-in.md) —— 裸宿主装载的默认定义。
</content>
