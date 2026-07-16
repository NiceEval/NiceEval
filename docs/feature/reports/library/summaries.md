# 概览组件

回答“这批结果有多大、整体是否健康、当前水位在哪”的三个组件。三者都没有计算选项：spec 形态只有可选的 `input`（默认宿主注入的 Scope），data 形态接收配套 `*Data` 函数的返回值；props 组合规则 `DataProps` 见[指标组件](metric-views.md)。

## `ExperimentComparison`

裸 `niceeval show` 与 `niceeval view` 首页经由[内建报告](built-in.md)渲染的默认组合件。它先把 `input` 按**可比组**分区，再为每组分别计算 `GroupSummary`、成本 × 端到端成功率散点和 `ExperimentList`。可比组键是 experiment id 的完整父路径：`compare/bub` 与 `compare/codex` 的键都是 `compare`，`bench/long/codex` 的键是 `bench/long`；没有父路径的 experiment 使用自己的完整 id 作为单例组键。不同组的数据不会进入同一个 scatter、series、排序或汇总。

端到端成功率对同一 experiment × eval 的多轮 attempt 先求均值，再跨 experiment × eval 求均值；`failed` 与 `errored` 为 0，`skipped` 为 `null`。组卡中的 verdict 构成另按 Eval 最终 verdict 计票：任一轮 passed 则 Eval passed，否则按 `failed > errored > skipped` 折叠。两者有意回答不同问题，渲染面不得从 verdict 计数反推成功率。

web 面持有完整组索引并一次聚焦一组，无 JS 时退化为各组独立的 `<details>`；text 面命中多个组时只显示组索引与可执行的单组查看命令，命中单组时才输出完整散点与列表。

```ts
interface ExperimentComparisonData {
  groups: ExperimentComparisonGroupData[];
}

interface ExperimentComparisonGroupData {
  /** experiment id 的完整父路径；根目录 experiment 使用完整 id。 */
  key: string;
  summary: GroupSummaryData;
  scatter: ScatterData;
  experiments: ExperimentListItem[];
}

function experimentComparisonData(input: ReportInput): Promise<ExperimentComparisonData>;

type ExperimentComparisonProps = DataProps<ExperimentComparisonData, {}, {
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<ExperimentComparison />
```

组按 `key` 字典序排列；组内 experiment 按端到端成功率从高到低预排。自定义报告若直接组合 [`MetricScatter`](metric-views.md#metricscatter) / [`ExperimentList`](entity-lists.md#experimentlist)，就是在显式接管分区责任。

## `RunOverview`

显示贡献当前数据的快照时间范围、experiment / eval / attempt 数、端到端成功率和总成本。Scope warning 不进组件 data：`show` / `view` 宿主已在报告树外统一显示，自有 React 页面则直接渲染 `scope.warnings`，不用内容匹配做去重。

```ts
interface RunOverviewData {
  range: { earliestStartedAt: string | null; latestStartedAt: string | null };
  experiments: number;
  /** experimentId + evalId 的去重计数。 */
  evals: number;
  attempts: number;
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  endToEndPassRate: MetricCell;
  /** costUSD 按 attempt 求和；缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

function runOverviewData(input: ReportInput): Promise<RunOverviewData>;

type RunOverviewProps = DataProps<RunOverviewData, {}, {
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<RunOverview />
```

`verdicts` 是 attempt 原始计票，`endToEndPassRate` 来自官方两级指标引擎；两者不互相反推。空范围的时间窗、成功率和总成本值都为 `null`，不编造当前时间或 0%。

## `GroupSummary`

显示一个范围内的 experiment / eval / attempt 数、Eval 最终 verdict 构成、端到端成功率、总成本和最后运行时间。一个 eval 在不同 experiment 中运行时是两道独立题，身份键为 `experimentId + evalId`。

```ts
interface GroupSummaryData {
  experiments: number;
  evals: number;
  attempts: number;
  /** 每个 experimentId + evalId 先折成最终 verdict 后计票。 */
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 官方两级 endToEndPassRate，不从 verdicts 重算。 */
  endToEndPassRate: MetricCell;
  /** costUSD 按 attempt 求和；完整 refs 允许下钻。 */
  totalCostUSD: MetricCell;
  lastRunAt: string | null;
}

function groupSummaryData(input: ReportInput): Promise<GroupSummaryData>;

type GroupSummaryProps = DataProps<GroupSummaryData, {}, {
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<GroupSummary input={scope.filter((snapshot) => snapshot.experimentId.startsWith("compare/"))} />
```

## 相关阅读

- [实体列表](entity-lists.md) —— 从汇总下钻到 experiment / eval / attempt。
- [指标组件](metric-views.md) —— 榜单、矩阵、散点与趋势，及 `DataProps` 组合规则。
- [内建报告](built-in.md) —— 裸宿主装载的默认定义。
