# 实体列表

实体列表用于从汇总下钻到事实：一行一个 experiment / eval / attempt，列是固定的。固定列不等于所有渲染面使用相同排版——web 面用表格支持人工比较，text 面用紧凑列表支持终端阅读，两面消费同一份可序列化 `data`。计算函数分别是 `experimentListData`、`evalListData` 与 `attemptListData`，props 组合规则见[组件树](../README.md#数据绑定与两种形态)。

列表不设 `evals` 选项：数据逐实体成行，聚合边界就是单实体，取数后用普通 JavaScript 过滤与任何选项严格等价。要过滤或截断，就在[组合组件](../../library/layout.md#自定义组件)里手工取数、加工后以 data 形态传入。

这一篇是实体列表族的共用机制：为什么不开放列、共用数据形状与时效标注。每个组件的专属渲染与用法在各自的文件里：[`ExperimentList`](experiment-list.md)、[`EvalList`](eval-list.md)、[`AttemptList`](attempt-list.md)、[`FailureList`](failure-list.md)。

## 为什么实体列表不开放列

实体列表没有结构子节点。列不是配置面，是下钻契约的一部分：

- **主读数列由题型构成决定，不由作者挑。** 通过制显示通过率、计分制显示总分、混型两列并出（[主读数映射](../../library/metrics.md#题型构成与主读数)）。开放选列就要求作者自己维护这个分支，报告一旦跑到另一种题型的 Sample 就会摆出空列。
- **列集合稳定，读者的迁移成本才为零。** 每份报告里的 experiment 表列序一致，读者不必重新找「成本在第几列」。
- **要自选列的组件已经有了**：[`MetricTable`](../tables/metric-table.md) 就是「行是维度值、列是你挑的指标」。两个组件如果都开放选列，它们就塌成同一个组件，而实体列表独有的展开层级（experiment → eval → attempt）、占位行与时效标注会被稀释成表格的一种配置。

展开层级同理不是选项：它由实体之间的从属关系决定。要别的形态就用[排版原语](../../library/layout.md)和 `MetricTable` 自己拼。

## 数据形状

```ts
interface AttemptListItem {
  experimentId: string;
  evalId: string;
  attempt: number;
  agent: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /**
   * 该轮的单行结果摘要，已按 Scoring display 契约折好：failed 取主失败断言摘要，
   * errored 取结构化 error 的一层摘要（phase · code · message）；计分制 passed 有丢分
   * 得分点时取首条丢分得分点摘要（含挣分尾缀），其余 passed / skipped 为 null。
   * 渲染面只做宽度截断，不重算摘要。
   */
  failureSummary: string | null;
  /** 主失败（或首条丢分得分点）之外还有几条失败断言 / 丢分得分点（"+N more failures" / "+N more lost points" 的 N）；无失败为 0。 */
  moreFailures: number;
  /** 当前 attempt 的 examScore 与证据引用。 */
  examScore: MetricCell;
  /** 当前 attempt 的挣分（[`totalScore` 指标](../../library/metrics.md#内置指标)）；通过制 eval 为 null cell（不适用，不是缺数据）。 */
  totalScore: MetricCell;
  durationMs: number;
  /** 缺失为 null（测不了），不伪造 0；attempt 级条目的缺失一律用 null，不用省略字段。 */
  costUSD: number | null;
  /** 执行时刻（携带条目为原执行时刻）。时效标注的时距从这里起算。 */
  startedAt: string;
  /** 历史执行：携带条目，或来自该实验在 Sample 中最新 Run 之外的 Run；false = 最新一次运行实测。 */
  historical: boolean;
  locator: AttemptLocator;
}

interface EvalListItem {
  experimentId: string;
  evalId: string;
  /** 任一轮 passed 即 passed，否则 failed > errored > skipped。 */
  verdict: "passed" | "failed" | "errored" | "skipped";
  examScore: MetricCell;
  /** 该题挣分（`totalScore` 指标，多轮按 perEval mean 折叠）；通过制 eval 为 null cell。 */
  totalScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

interface ExperimentListEvalRow {
  evalId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /** 该题挣分；通过制 eval 为 null cell。 */
  totalScore: MetricCell;
  durationMs: MetricCell;
  costUSD: MetricCell;
  attempts: AttemptListItem[];
}

interface ExperimentListItem {
  experimentId: string;
  agent: string;
  model?: string;
  flags?: Record<string, JsonValue>;
  /** 该 experiment 的题型（定义期事实，单个 experiment 内由启动期强制同型）。主读数列据此选择。 */
  scoring: "pass" | "points";
  /** eval 级最终 verdict 计票（Result 列的构成）。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  endToEndPassRate: MetricCell;
  /** 实验总分（[`totalScore` 指标](../../library/metrics.md#内置指标)：perEval mean、acrossEvals sum）；通过制实验为 null cell。 */
  totalScore: MetricCell;
  costUSD: MetricCell;
  durationMs: MetricCell;
  tokens: MetricCell;
  evals: number;
  attempts: number;
  /** 历史执行的 attempt 数（分母是 attempts）；时效标注「↩ n/m attempts」的数据源。 */
  historicalAttempts: number;
  /** 已知 eval 并集里、当前口径下没有任何 attempt 的题（来自 sample.coverage）；渲染为占位行。 */
  missingEvalIds: string[];
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}

function experimentListData(input: ReportInput): Promise<ExperimentListItem[]>;

function evalListData(input: ReportInput): Promise<EvalListItem[]>;

function attemptListData(input: ReportInput): Promise<AttemptListItem[]>;

type ExperimentListProps = ComponentProps<readonly ExperimentListItem[], {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type EvalListProps = ComponentProps<readonly EvalListItem[], {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type AttemptListProps = ComponentProps<readonly AttemptListItem[], {
  /** 过滤 / 截断前的总数；省略时等于 data 长度。 */
  total?: number;
  /** web 面加过滤输入框（按 experiment、eval、agent、verdict 或摘要文本收窄行）；渐进增强，不改变数据与 text 面。 */
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

### 时效标注

三个列表共用一条时效呈现规则，数据源是 `AttemptListItem.historical`（语义单点在 [Results · 时效](../../../sample/library.md#时效新执行与历史执行)）：

- **Attempt 行**：历史执行的 attempt 在 locator 后标 `↩` 加人话时距（如 `↩ 3d`，自 `startedAt` 起算）；web 面 hover 显示完整执行时刻，text 面直接打。新执行不标。
- **Eval 父行**：其**全部** attempt 均为历史执行时，在题目名后标 `↩ <最近一次执行的时距>`；新旧混合时父行不标，子行各自可见。
- **Experiment 行**：`historicalAttempts > 0` 时在副行追加 `↩ n/m attempts`。

标注是 subdued 的行内事实，不占框、不用警示色——携带是 fingerprint 担保下的正常缓存，跨 Run 拼接受 `currentSample()` 可比性前提保护，时效是数字的出身属性，不是警告。要完全排除历史执行，用 [`fresh` 口径](../../../sample/library.md#时效新执行与历史执行)（CLI 侧 `--fresh`），被排除的题按覆盖事实转为占位行。

## 相关阅读

- [组件树](../README.md) —— 为什么这一族没有结构子节点，以及页级色分配。
- [概览](../summaries/README.md) —— `ExperimentComparison` 怎样逐组消费这些列表。
- [表格与矩阵](../tables/README.md) —— 从实体切换到指标视角。
- [排版原语与自定义组件](../../library/layout.md) —— 承载手工取数与数组加工的组合组件。
- [Show](../../show.md) —— 同一份明细在终端的展示。
