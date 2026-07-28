# 实体数据源

实体行用于从汇总下钻到事实。`sources.entity.experiments`、`sources.entity.evals` 与
`sources.entity.attempts` 分别返回以对应实体为
顶层的 `TableContent`。固定列不表示两面排版相同:web 面用表格,text 面用紧凑层级行;两面消费
同一份 Content。

列表不设 `evals` 选项：数据逐实体成行，聚合边界就是单实体，取数后用普通 JavaScript 过滤与
任何选项严格等价。要过滤或截断，就在[组合组件](../../library/layout.md#自定义组件)里手工取数，
加工后以 data 形态传入。

呈现语义最重的 [`sources.entity.experiments`](entity-experiments.md) 单独成篇；`sources.entity.evals`
与 `sources.entity.attempts` 的专属语义在本篇[下文](#evals-与-attempts)。
[`FailureList`](../summaries/failure-list.md) 是筛选失败 Attempt 的组合组件。

## 为什么实体列表不开放列

实体列表没有结构子节点。列不是配置面，是下钻契约的一部分：

- **主读数列由题型构成决定，不由作者挑。** 通过制显示通过率、计分制显示总分、混型两列并出
  （[主读数映射](../../library/measures.md#题型构成与主读数)）。开放选列就要求作者自己维护这个
  分支，报告一旦跑到另一种题型的 Sample 就会摆出空列。
- **列集合稳定，读者的迁移成本才为零。** 每份报告里的 experiment 表列序一致，读者不必重新找「成本在第几列」。
- **自选列使用 [`sources.measure.rows`](measure-rows.md)。** 实体行独有的展开层级、占位行与时效
  标注不是通用读数表的一组选项。

展开层级由实体从属关系决定，唯一的例外是 `sources.entity.experiments` 的
[Eval 分组层](entity-experiments.md#eval-分组层)——按 evalId 的路径段递归嵌套，
即 eval 作者已经用文件路径声明过的组织方式，不是新造的分类维度。要别的形态,使用 `Table` 与其它数据源组合。

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
  /**
   * 行标签：有父组行时是去掉组前缀的剩余段（`downshift/pr-1484` 在 `downshift` 组下为
   * `pr-1484`），分组层收起时是完整 evalId。排序、过滤与展开始终用 `evalId`。
   */
  label: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  /** 该题挣分；通过制 eval 为 null cell。 */
  totalScore: MeasureCell;
  durationMs: MeasureCell;
  costUSD: MeasureCell;
  attempts: AttemptRow[];
}

/**
 * Eval 分组行（`variant: "group"`）。分组键是 evalId 的目录前缀；
 * 出现条件、组行列内容与排序过滤行为见
 * [Eval 分组层](entity-experiments.md#eval-分组层)。
 */
interface ExperimentEvalGroupRow extends Row {
  variant: "group";
  /** 本层路径段；完整路径前缀（含祖先）是展开身份与行 key。 */
  groupKey: string;
  /** 组内 eval 级最终 verdict 计票（Record 列的构成）。 */
  evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 分母只数有 attempt 的题；占位行不参与。 */
  passRate: MeasureCell;
  /** 组内挣分之和；通过制为 null cell。 */
  totalScore: MeasureCell;
  durationMs: MeasureCell;
  costUSD: MeasureCell;
  tokens: MeasureCell;
  /** 有 attempt 的题数。 */
  evals: number;
  /** 组内已知 eval 并集大小（含占位行）；等于 evals 时副行不写分数形式。 */
  knownEvals: number;
  attempts: number;
  evalRows: ExperimentEvalRow[];
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
  /**
   * 子行。分组层生效时是 `ExperimentEvalGroupRow[]`，外加 evalId 不含 `/` 的题（与组行同级）；
   * [无信息时整层收起](entity-experiments.md#无信息时整层收起)，退回纯 `ExperimentEvalRow[]`。
   * 按 `variant === "group"` 判别，与占位行的 `variant` 判别同一套机制。
   */
  evalRows: (ExperimentEvalGroupRow | ExperimentEvalRow)[];
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

## evals 与 attempts

`sources.entity.evals` 的顶层 Row 表示 `experimentId + evalId`，子行是一轮 Attempt。父行显示
折叠判定、Attempt 数、聚合分数、平均耗时与平均成本，但不复述任一轮的失败内容：

```tsx
const content = await ctx.resolve(sources.entity.evals);
const rows = content.rows.filter((row) => row.cells.verdict.verdict !== "passed");
<Table data={{ ...content, rows }} />
```

`sources.entity.attempts` 的每个 Row 显示一次 Attempt 的判定、单行结果摘要、`totalScore` 与
locator。完整 assertions、diagnostics、cause、stack 与自由文本证据不进入表格 Content；需要完整
结构时经 locator 调 [`resolveLocator`](../../../record/library.md#按-locator-寻址一个-attemptresolvelocator)：

```tsx
const content = await ctx.resolve(sources.entity.attempts);
const rows = content.rows
  .filter((row) => ["failed", "errored"].includes(row.cells.verdict.verdict ?? ""))
  .slice(0, 20);
<Table data={{ ...content, rows }} />
```

## 相关阅读

- [组件树](../README.md) —— 为什么这一族没有结构子节点，以及页级色分配。
- [概览](../summaries/README.md) —— `SampleOverview` 怎样逐组消费这些列表。
- [Measure 数据源](measure.md) —— 从实体切换到读数视角。
- [排版原语与自定义组件](../../library/layout.md) —— 承载手工取数与数组加工的组合组件。
- [Show](../../show.md) —— 同一份明细在终端的展示。
