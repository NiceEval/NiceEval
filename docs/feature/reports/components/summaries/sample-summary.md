# `SampleSummary`

显示一个范围的 Run 时间窗、experiment / eval / attempt 数、两级判定结果、主读数（通过率或总分）和总成本。Eval 的身份键是 `experimentId + evalId`：同一个 Eval 在不同 experiment 中运行时算两个独立 Eval，`evals` 与 `evalVerdicts` 都按这个身份计数。

web 面使用短标签 `Pass rate / 通过率`、`Total score / 总分`、`Experiments / 实验`、`Evals / Eval`、`Attempts / Attempt`、`Eval results / Eval 结果`（`votes="attempt"` 时为 `Attempt results / Attempt 结果`）和 `Total cost / 总成本`。这些是字段名，不在标签里重复“数”“次”或“计票”；数量由值本身表达。时间不直接暴露 ISO 字符串：单点写成 `Last run / 最近运行`，范围写成 `Run range / 运行范围`，时间值按当前 locale 格式化到分钟；同日范围不重复右端日期，同年跨日范围不重复右端年份。成本覆盖不全时，在金额下方用 `Cost available for 63/72 attempts / 63/72 次有成本数据` 解释覆盖范围，不能只放一个无语义的 `63/72` 角标。

主读数按 Sample 内出现的题型（`scoringComposition`，判据与公开函数单点在[主读数映射](../../library/metrics.md#题型构成与主读数)）切换：纯通过制（`"pass"`）只显示通过率，`totalScore` 省略；纯计分制（`"points"`）隐藏通过率、只显示总分（[`totalScore` 指标](../../library/metrics.md#内置指标)：`assertions[].points` 之和加 `scoreEntries[].points` 之和，errored/skipped 记 `null`）；混型（`"mixed"`，一个 Sample 并排通过制与计分制两个 experiment，见[计分粒度](../../../experiments/score-points.md)）两者都显示——不摆空列，只在相关时才出现对应的读数。

data 恒携带两级计票，两份序列化 JSON 摆在一起时口径自明；渲染面显示哪一级由呈现 prop `votes` 决定：

- `evalVerdicts`（`votes: "eval"`，默认）：每个 experimentId + evalId 先按「任一轮 passed 即 passed，否则 `failed > errored > skipped`」折成最终 verdict 后计票，回答「多少个 Eval 最终通过」。
- `attemptVerdicts`（`votes: "attempt"`）：attempt 原始计票，不折叠，回答「实际跑的每一轮各是什么结果」。

两级计票与 `endToEndPassRate` 互不反推：通过率来自官方两级指标引擎，渲染面不得从任一计票现场重算。Sample warning 与 Run diagnostic 都不进 `SampleSummaryData`：呈现件分别是 [`SampleWarnings`](../site/sample-warnings.md) 与 [`RunDiagnostics`](../site/run-diagnostics.md)，摘要数据不复制它们的输入，同一份事实不在页面上出现两次。

```ts
interface SampleSummaryData {
  /** 贡献当前数据的 Run 时间范围；空范围为 null，不编造当前时间。 */
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
   * 该 Sample 内出现的题型：`"pass"` 全部通过制、`"points"` 全部计分制、`"mixed"` 两者都有
   * （一个 Sample 可以并排多个 experiment，题型只在单个 experiment 内被强制统一）。渲染面据此
   * 决定主 KPI：`"points"` 隐藏通过率只显示 `totalScore`；`"mixed"` 两者都显示；`"pass"` 只
   * 显示通过率、`totalScore` 省略。
   */
  scoringComposition: "pass" | "points" | "mixed";
  /** 计分制总分（`totalScore` 指标）。仅 `scoringComposition` 为 `"points"` 或 `"mixed"` 时出现。 */
  totalScore?: MetricCell;
  /** costUSD 按 attempt 求和；缺失成本不伪造为 0。 */
  totalCostUSD: MetricCell;
}

function sampleSummaryData(input: ReportInput): Promise<SampleSummaryData>;

type SampleSummaryProps = ComponentProps<SampleSummaryData, {
  /** 显示哪一级计票；默认 "eval"。data 恒携带两级，votes 只选择呈现。 */
  votes?: "eval" | "attempt";
  locale?: ReportLocale;
  className?: string;
}>;
```

```tsx
<SampleSummary />                    // 当前 Sample 的摘要，eval 级计票
<SampleSummary votes="attempt" />    // 同一份 data，改看 attempt 原始计票
```

字段集由 Sample 的题型构成决定，所以它没有结构子节点：作者能决定的是放不放它、看哪一级计票。收窄范围时在[组合组件](../../library/layout.md#自定义组件)里显式传 `input`：

```tsx
const CompareSummary = defineComponent((_props: {}, ctx) => (
  <SampleSummary input={ctx.sample.pipe((s) => s.experimentId.startsWith("compare/"))} />
));
```

## 相关阅读

- [概览](README.md) —— `ExperimentComparison` 与本组件的关系。
- [`ExperimentComparison`](experiment-comparison.md) —— 把本组件摆进默认首页的组合件。
