# 实体列表

实体列表用于从汇总下钻到事实，不允许自由配置列。固定列不等于所有渲染面使用相同排版：web 面可以用表格支持人工比较，text 面可以用紧凑列表支持终端阅读，但两面必须消费同一份可序列化 `data`。计算函数分别是 `experimentListData`、`evalListData` 与 `attemptListData`；props 组合规则 `DataProps` 见[指标组件](metric-views.md)——spec 形态列出全量实体，要过滤或截断就在[组合组件](layout.md#自定义组件)里手工取数、用普通 JavaScript 加工后以 data 形态传入。列表数据逐实体成行，事后 JavaScript 过滤与任何选项严格等价，所以列表不设过滤选项；[指标组件的 `evals`](metric-views.md) 是聚合前收窄，属于另一类。

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
  /** 当前 attempt 的挣分（[`totalScore` 指标](metrics.md#内置指标)）；通过制 eval 为 null cell（不适用，不是缺数据）。 */
  totalScore: MetricCell;
  durationMs: number;
  /** 缺失为 null（测不了），不伪造 0；attempt 级条目的缺失一律用 null，不用省略字段。 */
  costUSD: number | null;
  /** 执行时刻（携带条目为原执行时刻）。时效标注的时距从这里起算。 */
  startedAt: string;
  /** 历史执行：携带条目，或来自该实验在 Scope 中最新快照之外的快照；false = 最新一次运行实测。 */
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
  /** 实验总分（[`totalScore` 指标](metrics.md#内置指标)：perEval mean、acrossEvals sum）；通过制实验为 null cell。 */
  totalScore: MetricCell;
  costUSD: MetricCell;
  durationMs: MetricCell;
  tokens: MetricCell;
  evals: number;
  attempts: number;
  /** 历史执行的 attempt 数（分母是 attempts）；时效标注「↩ n/m attempts」的数据源。 */
  historicalAttempts: number;
  /** 已知 eval 并集里、当前口径下没有任何 attempt 的题（来自 scope.coverage）；渲染为占位行。 */
  missingEvalIds: string[];
  lastRunAt: string;
  evalRows: ExperimentListEvalRow[];
}

function experimentListData(input: ReportInput): Promise<ExperimentListItem[]>;

function evalListData(input: ReportInput): Promise<EvalListItem[]>;

function attemptListData(input: ReportInput): Promise<AttemptListItem[]>;

// 实体列表没有计算选项(见开篇:过滤、截断都是取数后的普通 JavaScript),DataProps 的 Options 腿为空。
type ExperimentListProps = DataProps<readonly ExperimentListItem[], {}, {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type EvalListProps = DataProps<readonly EvalListItem[], {}, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;

type AttemptListProps = DataProps<readonly AttemptListItem[], {}, {
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

三个列表共用一条时效呈现规则，数据源是 `AttemptListItem.historical`（语义单点在 [Results · 时效](../../results/library.md#时效新执行与历史执行)）：

- **Attempt 行**：历史执行的 attempt 在 locator 后标 `↩` 加人话时距（如 `↩ 3d`，自 `startedAt` 起算）；web 面 hover 显示完整执行时刻，text 面直接打。新执行不标。
- **Eval 父行**：其**全部** attempt 均为历史执行时，在题目名后标 `↩ <最近一次执行的时距>`；新旧混合时父行不标，子行各自可见。
- **Experiment 行**：`historicalAttempts > 0` 时在副行追加 `↩ n/m attempts`。

标注是 subdued 的行内事实，不占框、不用警示色——携带是 fingerprint 担保下的正常缓存，跨快照拼接受 `current()` 可比性前提保护，时效是数字的出身属性，不是警告。要完全排除历史执行，用 [`fresh` 口径](../../results/library.md#时效新执行与历史执行)（CLI 侧 `--fresh`），被排除的题按覆盖事实转为占位行。

## `ExperimentList`

每项显示 experiment 身份、agent / model、flags、判定构成、官方指标和其中的 eval。组件不推断分组；默认 `ExperimentComparison` 把当前 Scope 的全部 items 交给它。

一行只有一套 `agent / model / flags`，这不是显示上的取舍而是输入约束：宿主注入的 [`current()` Scope 保证每个 experiment 只由可比性配置一致的快照拼成](../../results/library.md#官方现刻水位resultscurrent)；作者自选 `Snapshot[]` 时若同一 experiment 混入不一致的可比性配置，`experimentListData` 按完整用户反馈失败并指引——看跨配置演化用 `snapshot` 维度或 [`MetricLine`](metric-views.md#metricline)，不把两套配置拼成一行冒充单一配置。

web 面是固定列的 experiment 比较表，而不是无表头的松散卡片列表。主表一行一个 experiment，列顺序固定为：

| 列 | 内容 |
|---|---|
| Experiment | experiment id 在当前列表里的最短唯一后缀（见下）；副行以“`8 evals` / `8 个 Eval`”显示 eval 数——存在覆盖缺口时写成 `6/8 evals`（分母是已知并集），attempt 数多于 eval 数时再显示 attempt 数，最后跟最后运行时间；`historicalAttempts > 0` 时追加时效标注 `↩ n/m attempts`（见[时效标注](#时效标注)）；不把 Eval 翻成“题”。完整 id 仍用于排序键、过滤和折叠展开 |
| Model | model；缺失时显示明确空值 |
| Agent | agent |
| Avg. time | 官方 `durationMs` 聚合值；中文列名为“平均耗时” |
| 主读数 | 按列表内题型构成选择（[主读数映射](metrics.md#题型构成与主读数)）：全通过制为“Pass rate / 通过率”列（官方 `endToEndPassRate`）；全计分制为“Total score / 总分”列（官方 `totalScore`）；两型并存时两列都出、不适用格显示 `—`，不摆空列。默认按主读数列从高到低排序；两型并存时两种读数不能互相排名，默认改按 experiment id 字典序，两个主读数列仍各自可点击排序 |
| Tokens | 官方 `tokens` 聚合值 |
| Cost | 实验总成本：官方 `costUSD` 逐 attempt 求和（每题均值口径归散点等指标组件，见[默认报告](../show/default-report.md)）；实测成本优先、估算兜底，列头不断言口径 |
| Results | passed / failed / errored / skipped 的 eval 级判定构成，各项以中点分隔，不渲染成类似按钮的胶囊 |

表头支持点击排序；标签和排序箭头作为一个不换行的单元对齐，当前排序方向始终可见，其余列的排序提示只在 hover / focus 时显示。宽度不足时整表横向滚动，不把标签与箭头拆成两行。`filter` 为 web 面增加过滤输入框，可按 experiment、agent、model、flag 或 eval 文本收窄行。排序和过滤只改变浏览状态，不改变数据、指标口径或 text 面输出。每个 experiment 行使用原生 `<details>` 展开，展开区显示 flags 和 Eval 列表。Eval 父行只显示折叠判定、Attempt 数以及这个 Eval 的平均耗时 / 平均成本，计分制实验的 Eval 父行与 Attempt 子行还各自显示挣分；每个 Attempt 子行再显示该轮判定、locator、耗时 / 成本与 [Scoring 定义的主失败断言摘要](../../scoring/library/display.md#主失败断言怎样选)，可继续下钻到 Attempt 详情。父行不复述某一轮的失败原因：单轮时会与唯一子行重复，多轮时挑任一轮又会冒充 Eval 级事实。通过制 passed attempt 的 Result 是 `—`，不罗列通过的 assertions；计分制 passed attempt 有丢分得分点时 Result 显示首条丢分摘要（[丢分摘要规则](../../scoring/library/display.md#主失败断言怎样选)），挣满才显示 `—`。

覆盖缺口呈现为**占位行**：`missingEvalIds` 里的每道题在展开区渲染一条 Eval 父行，状态列为 `—`，结果列为「当前配置下无结果」加可复制的补跑命令（`niceeval exp <experimentId>`），无 attempt 子行；text 面同构。占位行不参与任何指标——通过率、耗时、成本的分母仍是有 attempt 的题，缺口不冒充失败；它的职责是把分母缺口摆进读者正在看的表里，而不是藏进页面级脚注。

行标签是 experiment id 在当前列表里的最短唯一后缀：末段（最后一个 `/` 之后的部分）在这批 id 里唯一就只显示末段；多个 id 末段撞名时，撞名的那几个各自向前多取一段，重复直到互相区分为止（与 [`MetricScatter`](metric-views.md#metricscatter) 散点的点标签同一算法，两处共用同一份实现）。这是纯展示层的收窄，不是身份判定——排序键、过滤匹配和折叠展开都用完整 id，视觉系列色也跟随 Agent 而不是这个显示名。组件不提供覆盖这份自动结果的开关：算法本身已经保证「唯一时最短、撞名时刚好够用的长度」，报告作者不需要手动指定要去掉的路径前缀。

text 面先输出与 web 同列口径的 experiment 比较表（列集合随主读数规则，与 web 面一致），再按 experiment 输出 Eval / Attempt 明细表。Eval 是父行，不是 Attempt 行上的重复字段；Attempt 用 `├─` / `└─` 子行显示一对多关系。明细列固定为状态、Eval / Attempt、结果、耗时、成本（计分制 Scope 在结果列前插入挣分列）；窄终端复用标准 text table renderer 折行或从右侧隐藏低优先级列，并明确报告隐藏列数：

```text
Experiment      Model          Agent   Avg. time   Pass rate   Tokens   Cost    Results
compare/codex   gpt-5.4-mini   codex   1m 12s      50%         42k      $0.08   1 passed · 1 failed
2/3 evals · 3 attempts · ↩ 1/3 attempts · 2026-07-12 18:08

compare/codex
Status      Eval / Attempt       Result                       Duration   Cost
✓ passed    algebra/retry                                      17.1s avg   $0.02 avg
  ✗         ├─ @1first01         equals(42) · received 41   16.0s   $0.02
  ✓         └─ @1second2         —                            18.2s      $0.02
✗ failed    weather/tool   ↩ 3d                               42.1s avg   $0.04 avg
  ✗         └─ @1third03   ↩ 3d   calledTool("get_weather") · received 2 tool calls: get_time({}) …   42.1s   $0.04
—           weather/rerank       当前配置下无结果 · niceeval exp compare/codex
```

计分制 Scope 的同一张表把主列换成总分，Eval / Attempt 明细行各自附挣分；Result 列遵守同一套摘要规则——中止的 attempt 显示中止前置的摘要，passed 但有丢分的显示首条丢分得分点摘要：

```text
Experiment    Model     Agent    Avg. time   Total score   Tokens   Cost    Results
exam/claude   gpt-5.6   claude   9m 20s      142           3.9M     $4.37   36 passed · 4 failed
exam/codex    gpt-5.6   codex    7m 02s      117           2.8M     $3.10   33 passed · 7 failed

exam/claude
Status      Eval / Attempt              Score   Result                                                        Duration   Cost
✓ passed    dbgpt/health-probe          4
  ✓         └─ @1hlthp01                4       commandSucceeded() · received exit 1 · +0 pts · +1 more lost point   6m 40s   $0.42
✗ failed    dbgpt/install-start         1
  ✗         └─ @1dbgpt001               1       calledTool("shell", { input: { command: /pip install/ } }) · received 0 tool calls   4m 12s   $0.31
```

窄屏允许表格横向滚动，不能为了适应宽度删除列、把多个无标签数值挤成一串，或退化成无法判断各数字含义的无表头布局。

```tsx
// 全量列表：spec 形态一行
<ExperimentList filter />
```

```tsx
// 过滤后的列表：组合组件里手工取数，用普通 JavaScript 收窄
export const ProdExperiments = defineComponent(async (_props: {}, ctx) => {
  const items = await experimentListData(ctx.scope);
  return <ExperimentList data={items.filter((x) => x.experimentId.startsWith("prod/"))} filter />;
});
```

## `EvalList`

每项表示 `experimentId + evalId`。父行显示折叠判定、Attempt 数、聚合分数、平均耗时和平均成本，展开后由每个 Attempt 子行分别显示该轮的主失败摘要或结构化错误摘要。比较层不展开全部 assertions，也不在 Eval 父行复述某个 Attempt 的失败内容。

```tsx
const items = await evalListData(ctx.scope);
<EvalList data={items.filter((x) => x.verdict !== "passed")} />
```

## `AttemptList`

每项显示一次 attempt 的判定、单行结果摘要（`failureSummary`）、`examScore` 和 locator。[内建报告的 Attempts 页](built-in.md)就是 `<AttemptList filter />`——`filter` 与 `ExperimentList` 同规则，是 web 面的渐进增强过滤框。完整 assertions（含 judge 的 evidence）、diagnostics、cause 与 stack 不进 `AttemptListItem`——列表 data 只携带按 [Scoring display 契约](../../scoring/library/display.md#主失败断言怎样选)算好的摘要；需要完整结构时经 locator 回读取面（[`resolveLocator`](../../results/library.md#按-locator-寻址一个-attemptresolvelocator) → `AttemptHandle`），列表 JSON 因此不会携带 stack、evidence 或自由文本证据。最常见的失败清单有成品 [`FailureList`](#failurelist)；`AttemptList` 服务其余自选集合。

```tsx
const all = await attemptListData(ctx.scope);
const failed = all.filter((x) => x.verdict === "failed" || x.verdict === "errored");

<AttemptList data={failed.slice(0, 20)} total={failed.length} />
```

## `FailureList`

「现在有哪些失败要处理」是每份报告都要的固定区块，所以工具箱直接提供成品组合件，不用每个报告重写同一段取数过滤。它与手写组合组件严格等价：内部就是 `attemptListData` → 过滤 → `AttemptList` data 形态，没有私有能力。

- 收 `verdict` 为 `failed` 或 `errored` 的 attempt；
- 按 attempt 开始时间降序（最近的失败在前），同刻按 locator 字典序收口；
- 截断到 `limit`（默认 20），`AttemptList` 的 `total` 报告截断前总数。

```ts
type FailureListProps = {
  /** 显示的最大条数；默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
};
```

```tsx
<FailureList limit={30} />
```

其它筛选口径（只看某个 agent、按成本排序）不属于它——写[组合组件](layout.md#自定义组件)加工 `attemptListData` 的结果，`FailureList` 只覆盖这一种最常见的问题。

## 相关阅读

- [概览组件](summaries.md) —— `ExperimentComparison` 怎样逐组消费这些列表。
- [指标组件](metric-views.md) —— 从实体切换到指标视角，及 `DataProps` 组合规则。
- [排版原语与自定义组件](layout.md) —— 承载手工取数与数组加工的组合组件。
- [Show](../show.md) —— 同一份明细在终端的展示。
