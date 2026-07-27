# 实体列表

实体行用于从汇总下钻到事实。`sources.entity.experiments`、`sources.entity.evals` 与
`sources.entity.attempts` 分别返回以对应实体为
顶层的 `TableContent`。固定列不表示两面排版相同:web 面用表格,text 面用紧凑层级行;两面消费
同一份 Content。

列表不设 `evals` 选项：数据逐实体成行，聚合边界就是单实体，取数后用普通 JavaScript 过滤与
任何选项严格等价。要过滤或截断，就在[组合组件](../../library/layout.md#自定义组件)里手工取数，
加工后以 data 形态传入。

各数据源的专属语义见 [`sources.entity.experiments`](experiment-rows.md)、[`sources.entity.evals`](eval-rows.md) 与
[`sources.entity.attempts`](attempt-rows.md);[`FailureList`](failure-list.md) 是筛选失败 Attempt 的组合组件。

## 为什么实体列表不开放列

实体列表没有结构子节点。列不是配置面，是下钻契约的一部分：

- **主读数列由题型构成决定，不由作者挑。** 通过制显示通过率、计分制显示总分、混型两列并出
  （[主读数映射](../../library/measures.md#题型构成与主读数)）。开放选列就要求作者自己维护这个
  分支，报告一旦跑到另一种题型的 Sample 就会摆出空列。
- **列集合稳定，读者的迁移成本才为零。** 每份报告里的 experiment 表列序一致，读者不必重新找「成本在第几列」。
- **自选列使用 [`sources.measure.rows`](../tables/measure-table.md)。** 实体行独有的展开层级、占位行与时效
  标注不是通用读数表的一组选项。

展开层级由实体从属关系决定。要别的形态,使用 `Table` 与其它数据源组合。

## 数据形状

```ts
interface AttemptRow extends Row {
  experimentId: string;
  evalId: string;
  attempt: number;
  agent: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /**
   * 该轮的单行结果摘要，已按 Assertion display 契约折好：failed 取主失败断言摘要，
   * errored 取结构化 error 的一层摘要（phase · code · message）；计分制 passed 有丢分
   * 得分点时取首条丢分得分点摘要（含挣分尾缀），其余 passed / skipped 为 null。
   * 渲染面只做宽度截断，不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败（或首条丢分得分点）之外还有几条失败断言 / 丢分得分点（"+N more failures" / "+N more lost points" 的 N）；无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的挣分（[`totalScore` 读数](../../library/measures.md#内置读数)）；通过制 eval 为 null cell（不适用，不是缺数据）。 */
  totalScore: MeasureCell;
  durationMs: number;
  /** 缺失为 null（测不了），不伪造 0；attempt 级条目的缺失一律用 null，不用省略字段。 */
  costUSD: number | null;
  /** 执行时刻（携带条目为原执行时刻）。时效标注的时距从这里起算。 */
  startedAt: string;
  /** 历史执行：携带条目，或来自该实验在 Sample 中最新 Run 之外的 Run；false = 最新一次运行实测。 */
  historical: boolean;
  locator: AttemptLocator;
}

interface EvalRow extends Row {
  experimentId: string;
  evalId: string;
  /** 任一轮 passed 即 passed，否则 failed > errored > skipped。 */
  verdict: "passed" | "failed" | "errored" | "skipped";
  /** 该题挣分（`totalScore` 读数，多轮按 perEval mean 折叠）；通过制 eval 为 null cell。 */
  totalScore: MeasureCell;
  durationMs: MeasureCell;
  costUSD: MeasureCell;
  attempts: AttemptRow[];
}

interface ExperimentEvalRow extends Row {
  evalId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /** 该题挣分；通过制 eval 为 null cell。 */
  totalScore: MeasureCell;
  durationMs: MeasureCell;
  costUSD: MeasureCell;
  attempts: AttemptRow[];
}

interface ExperimentRow extends Row {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, JsonValue>;
  /** 该 experiment 的题型（定义期事实，单个 experiment 内由启动期强制同型）。主读数列据此选择。 */
  scoring: "pass" | "points";
  /** eval 级最终 verdict 计票（Result 列的构成）。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  passRate: MeasureCell;
  /** 实验总分（[`totalScore` 读数](../../library/measures.md#内置读数)：perEval mean、acrossEvals sum）；通过制实验为 null cell。 */
  totalScore: MeasureCell;
  costUSD: MeasureCell;
  durationMs: MeasureCell;
  tokens: MeasureCell;
  evals: number;
  attempts: number;
  /** 历史执行的 attempt 数（分母是 attempts）；时效标注「↩ n/m attempts」的数据源。 */
  historicalAttempts: number;
  /** 已知 eval 并集里、当前口径下没有任何 attempt 的题（来自 sample.coverage）；渲染为占位行。 */
  missingEvalIds: string[];
  lastRunAt: string;
  evalRows: ExperimentEvalRow[];
}

interface EntitySources {
  experiments: Source<Sample, TableContent<ExperimentRow>>;
  evals: Source<Sample, TableContent<EvalRow>>;
  attempts: Source<Sample, TableContent<AttemptRow>>;
}
```

### 时效标注

三个数据源共用一条时效呈现规则,事实字段是 `AttemptRow.historical`。语义单点见
[Sample · 时效](../../../sample/library.md#时效新执行与历史执行)。

- **Attempt 行**：历史执行的 attempt 在 locator 后标 `↩` 加人话时距（如 `↩ 3d`，自
  `startedAt` 起算）；web 面 hover 显示完整执行时刻，text 面直接打。新执行不标。
- **Eval 父行**：其**全部** attempt 均为历史执行时，在题目名后标
  `↩ <最近一次执行的时距>`；新旧混合时父行不标，子行各自可见。
- **Experiment 行**：`historicalAttempts > 0` 时在副行追加 `↩ n/m attempts`。

标注是 subdued 的行内事实，不占框、不用警示色。携带是 fingerprint 担保下的正常缓存，跨 Run
拼接受 `currentSample()` 可比性前提保护；时效是数字的出身属性，不是警告。要完全排除历史执行，
用 [`fresh` 口径](../../../sample/library.md#时效新执行与历史执行)（CLI 侧 `--fresh`）。被排除的题
按覆盖事实转为占位行。

## 相关阅读

- [组件树](../README.md) —— 为什么这一族没有结构子节点，以及页级色分配。
- [概览](../summaries/README.md) —— `SampleOverview` 怎样逐组消费这些列表。
- [表格与矩阵](../tables/README.md) —— 从实体切换到读数视角。
- [排版原语与自定义组件](../../library/layout.md) —— 承载手工取数与数组加工的组合组件。
- [Show](../../show.md) —— 同一份明细在终端的展示。
