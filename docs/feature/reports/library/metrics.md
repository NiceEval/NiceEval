# 指标与维度

指标定义值与聚合口径，维度定义分组；[指标组件](metric-views.md)只是它们的投影。

## 公开计算模型

```ts
type ReportInput = Scope | readonly Snapshot[];
type Aggregator = "mean" | "sum" | "min" | "max" |
  ((values: readonly number[]) => number);

interface MetricAggregate {
  /** 同一 experiment × eval 的多个 attempt 先折成题级值；默认 mean。 */
  perEval?: Aggregator;
  /** 题级值再跨 experiment × eval 折成终值；默认 mean。 */
  acrossEvals?: Aggregator;
}

interface Metric<Name extends string = string> {
  name: Name;
  /** 省略时使用 name；渲染面按 locale 选择。 */
  label?: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  better?: "higher" | "lower";
  /** 指标值的自然边界（如通过率 0–1、成本下界 0）。图轴呼吸边距不越过声明的边界，见指标组件页「图轴值域」。 */
  bounds?: { min?: number; max?: number };
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  aggregate?: MetricAggregate;
  /** 只格式化同一个终值，不按 locale 分裂计算口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

function defineMetric<const Name extends string>(
  metric: Metric<Name>,
): Metric<Name>;

interface MetricColumn {
  key: string;
  label: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
}

interface MetricCell {
  value: number | null;
  /** 计算函数为官方生成面覆盖的每个 locale（当前 en、zh-CN）生成显示值，renderer 按 LocalizedText 回退规则选择；其它 locale 回退 en。 */
  display: LocalizedText;
  /** 指标返回非 null 的 attempt 数。 */
  samples: number;
  /** 本格子覆盖的 attempt 总数，包含值为 null 的 attempt。 */
  total: number;
  /** 本格子覆盖的全部 attempt，包含指标值为 null 的证据。 */
  refs: AttemptLocator[];
}
```

`MetricCell.refs` 跟随覆盖范围而不是只跟随有效样本：用户看到 `samples < total` 时，仍能下钻到那些“为什么测不了”的 attempt。跨快照计算在分组前先按 Results 身份键去重。聚合中的题级身份始终是 `experimentId + evalId`；按 agent 等更宽维度合并多个 experiment 时，不会把不同 experiment 的同名 eval 当成重试。

计算失败与缺数据严格分开：`value()` 对预期缺失返回 `null`；`where` / `value` / 自定义 aggregator / `display` 抛错时，整个 `*Data` 调用失败，错误带 metric name、attempt locator（适用时）与 cause，不把代码错误伪装成“测不了”。`value` 和 aggregator 的非 null 返回值必须是有限数，`NaN` / `Infinity` 同样报错。aggregator 只会收到去掉 `null` 后的非空数组。

输出顺序是确定的：Metric 名在同一组件的列集合中必须唯一；维度 key 的默认顺序为 Unicode 字典序，显式排序保持稳定并以 key 打破同值；`refs` 去重后按 AttemptLocator 字典序排列。只要自定义回调本身是确定的，相同输入与 niceeval 版本就生成字节级稳定的 JSON。

## 内置指标

| 指标 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `endToEndPassRate` | 默认通过率：passed = 1，failed / errored = 0，回答实际交付通过结果的概率 | 高 | `result.json` |
| `taskPassRate` | 条件答题通过率：passed = 1，failed = 0，errored 记 `null`；即只在已形成可信判定的样本上回答 Agent 答题质量 | 高 | `result.json` |
| `executionReliability` | 执行可靠性：跑到可判定（passed / failed）= 1，errored = 0；回答一次运行能否形成可信判定 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `totalScore` | 计分制（`defineScoreEval`）eval 的挣分：`assertions[].points` 之和加 `scoreEntries[].points` 之和，纯累加不声明满分；通过制 eval（`scoring` 省略或 `"pass"`）恒 `null`，不参与聚合 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时（不含收尾段，口径见 [Results](../../results/architecture.md#resultjson)）；对超时 attempt（`error.code = "timeout"`）返回 `null`——线值是右删失点不是实测完成耗时，计入聚合会把「被砍断」当成「跑了这么久」，排除又会让慢条件显得快，删失只能显式呈现（见下） | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `assistantTurns` | o11y 事件流中的 assistant turn 数；与 `t.send` 的轮次（轮标签 `turn<N>`）是两个计数，名字因此带限定词 | 低 | `o11y.json` |
| `repeatedFailedCommands` | 同一 attempt 内同一条 shell 命令的重复失败数：每条命令失败 n 次（n > 1）记 n − 1，求和。回答 agent 是否在反复撞同一个已知失败的命令 | 低 | `o11y.json` |

内置指标都声明 `bounds`：三个通过率指标与 `examScore` 是 `{ min: 0, max: 1 }`（质量分是 soft 断言的均值），其余（`totalScore`、`durationMs`、`tokens`、`costUSD`、`assistantTurns`、`repeatedFailedCommands`）是 `{ min: 0 }`——计分制分值非负（[计分粒度](../../experiments/score-points.md)），耗时、tokens、成本与计数天然非负。

`skipped` 对这些指标返回 `null`。`durationMs` 的超时删失同样走 `null`,但删失不允许静默:`null` 使格子的 `samples` 小于 `total`,而 `samples` / `total` / `refs` 本就是渲染层不可丢弃的字段([聚合不变量](../architecture.md#指标聚合不变量))——耗时对比里被超时截断的样本因此以覆盖率缺口的形态可见,不会让「砍掉最慢的样本」伪装成「这个条件更快」。超时线的选取纪律(远离自然耗时上沿、对固定协议开销的条件不中立)见 [Runner · 超时](../../../runner.md#超时双层保护)。`errored` 只在 `taskPassRate` 中返回 `null`，在默认 `endToEndPassRate` 与 `executionReliability` 中都返回 0。三个指标都遵守“先在同一 eval 的 attempts 内聚合，再跨 eval 聚合”的两级规则；每个 eval 只有一个 attempt 时，`endToEndPassRate` 才简化为 `passed / (passed + failed + errored)`。它的完整口径名是“End-to-end pass rate / 端到端通过率”，默认组件的可见短标签统一为“Pass rate / 通过率”；任何默认总览和任何只写这个短标签的位置都使用 `endToEndPassRate`。`taskPassRate` 必须标成“Task pass rate / 可判定任务通过率”等条件口径，不能把 `2 passed / 5 errored` 显示成无条件的 `100%`。要定位损失来自答题还是执行，可把三列并排：

```tsx
<MetricTable
  rows="experiment"
  columns={[endToEndPassRate, taskPassRate, executionReliability]}
  sort={endToEndPassRate}
/>
```

`assistantTurns` 与 `repeatedFailedCommands` 需要 `o11y.json`；发布时没复制该 artifact 就显示缺失，不会冒充 0。`endToEndPassRate` 与 Eval 最终 verdict 是两个问题：前者衡量单次实际交付成功的概率；后者为了 early-exit / 退出码按 `passed > failed > errored > skipped` 折叠多轮。Reports 可以同时展示终态判定构成和 `endToEndPassRate`，但不得用前者现场重算后者。

`totalScore` 是「`skipped` 记 null、`errored` 记 0」这条通用规则的例外：它对 `errored` **与** `skipped` 都记 `null`（基础设施得 null，不折成 0——中止挣 0 是 `test()` 控制流自然产生的事实，已经体现在 `points` 求和里，不需要指标层再折一次），对通过制 eval（`scoring` 省略或显式 `"pass"`）也恒记 `null`（不适用，不是缺数据）。聚合方向同样是例外：`perEval` 用默认 `mean`（`runs > 1` 时同一 eval 的多轮取均值），但 `acrossEvals` 用 `sum`（不是默认的 `mean`）——「总分 = Σ 各 eval 挣分」，跨题不取平均。

## 题型构成与主读数

一个范围的对比主读数由其中出现的题型决定（裁决在[计分粒度](../../experiments/score-points.md#横截面聚合同型实验各读各的)）：通过制读通过率，计分制读总分。题型是定义期事实（`EvalDescriptor.scoring`，单个 experiment 内由启动期强制同型），所以这个选择不依赖任何 attempt 结果——题目一行代码没跑时就有答案。

```ts
type ScoringComposition = "pass" | "points" | "mixed";

/** input 内出现的题型构成，取自快照记录的定义期 `scoring` 事实。 */
function scoringComposition(input: ReportInput): Promise<ScoringComposition>;
```

**主读数映射是单点规则**，官方消费者都引用这一条，不各自另设判据：

| 构成 | 主读数 | 官方消费面的行为 |
|---|---|---|
| `"pass"` | `endToEndPassRate` | 摘要主 KPI、榜单主列、默认散点 y 轴与预排序全用通过率 |
| `"points"` | `totalScore` | 同上位置全部换成总分；通过率不出现（不摆空列） |
| `"mixed"` | 两者并排、各读各的 | 「过了 31/40 道」和「挣了 142 分」不能相加也不能互相排名：摘要两个 KPI 都显示，按题型拆组的位置各组用自己的主读数 |

组件本身保持中立：`MetricScatter` / `MetricTable` 只收 `Metric`，不感知题型；分支只发生在消费 `scoringComposition` 的那几处组装点——[`ScopeSummary`](summaries.md#scopesummary) 的渲染面、[`ExperimentList`](entity-lists.md#experimentlist) 的主列、[`ExperimentComparison`](summaries.md#experimentcomparison) 的 compose。自定义报告需要同样的切换时调用同一个函数，不重新发明判据。

## 自定义指标

```ts
import { defineMetric } from "niceeval/report";

export const changedLines = defineMetric({
  name: "changed-lines",
  label: { en: "Changed lines", "zh-CN": "改动行数" },
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.keys(diff.files)
      .reduce((sum, path) => sum + (diff.get(path) ?? "").split("\n").length, 0);
  },
  aggregate: { perEval: "min", acrossEvals: "mean" },
});
```

- `null` 表示测不了，不进入聚合；`0` 表示测得结果为零，会正常进入聚合。
- `where` 是进入计算前的显式条件，适合“只比较通过方案的代码量”。
- 聚合先在同一 experiment × eval 的多个 attempt 之间折叠，再跨 experiment × eval 折叠；两级默认都是 `mean`。
- `unit` 驱动内置格式化；需要特殊显示时提供 `display(value, locale)`。计算函数为所有受支持 locale 生成 `MetricCell.display`，数值仍只有一个 `value`。

## 维度与数值轴

可直接使用的维度有 `agent`、`model`、`experiment`、`eval`、`evalGroup` 和 `snapshot`。`evalGroup` 取 eval id 的完整父路径，没有 `/` 时取完整 id，例如 `security/sql-injection` 归 `security`，`a/b/c` 归 `a/b`。它只组织 eval，不组织 experiment。完整形状是：

```ts
type BuiltInDimension =
  | "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot";

interface CustomDimension {
  name: string;
  of(attempt: AttemptHandle): string;
}

interface DimensionRef {
  readonly kind: "flag" | "runConfig" | "label" | "fact";
  readonly name: string;
  readonly label?: LocalizedText;
  readonly unit?: string;
}

type DimensionInput = BuiltInDimension | CustomDimension | DimensionRef;

/** series 类选项(MetricScatter / MetricLine / ExperimentComparison)额外接受非空数组,解析为复合维度。 */
type SeriesInput = DimensionInput | readonly [DimensionInput, ...DimensionInput[]];

interface NumericAxis {
  name: string;
  label?: LocalizedText;
  unit?: string;
  of(attempt: AttemptHandle): number | null;
}

interface DimensionOptions {
  label?: LocalizedText;
  unit?: string;
}

interface NumericAxisOptions extends DimensionOptions {}

interface NumericRunConfigAxisOptions extends NumericAxisOptions {
  /** 字符串配置到数值轴的显式映射；数值配置不需要。 */
  map?: Readonly<Record<string, number>>;
}

/** runConfig() 的可用键：ExperimentRunInfo 字段全集，外加桥接到快照顶层权威字段的 model / agent。 */
type RunConfigKey = keyof ExperimentRunInfo | "model" | "agent";

function flag(name: string, options?: DimensionOptions): DimensionRef;
function label(name: string, options?: DimensionOptions): DimensionRef;
function runConfig(name: RunConfigKey, options?: DimensionOptions): DimensionRef;
function fact(name: string, options?: DimensionOptions): DimensionRef;
function numericFlag(name: string, options?: NumericAxisOptions): NumericAxis;
function numericLabel(name: string, options?: NumericAxisOptions): NumericAxis;
function numericRunConfig(name: RunConfigKey, options?: NumericRunConfigAxisOptions): NumericAxis;
function numericFact(name: string, options?: NumericAxisOptions): NumericAxis;
```

自定义维度：

```ts
const verdictFamily = {
  name: "verdict-family",
  of: (attempt) => attempt.result.verdict === "passed" ? "pass" : "needs-work",
};
```

experiment 中声明的变量用声明它的字段对应的构造器读取，不从 experiment id 字符串猜。三个声明来源三个构造器，一一对应：`flag()` 读 `ExperimentDef.flags`（运行参数，agent / eval 可见），`label()` 读 `ExperimentDef.labels`（报告归类标注，运行时不可见，声明语义见 [Experiments · labels](../../experiments/library.md#labels声明归类坐标不进运行时)），`runConfig()` 读顶层运行配置：

```ts
const memory = label("memory", { label: "Memory mechanism" });
const webResearch = flag("webResearch", { label: "Web research" });
```

`model`、`reasoningEffort`、`budget`、`runs` 这类**顶层运行配置不在 `flags` 里**，用 `runConfig()` 读快照的 [`ExperimentRunInfo`](../../results/architecture.md#snapshotjson) 投影——名字点明读的是这次运行的落盘配置，与项目的 `niceeval.config.ts` 无关；可用键由 `RunConfigKey` 在类型层穷尽（那张接口的字段全集，外加桥接到快照顶层权威字段的 `model` / `agent`），拼错键在编译期就被拒绝：

```ts
const reasoning = runConfig("reasoningEffort", { label: "Reasoning effort" });
const budget = runConfig("budget", { label: "Budget", unit: "USD" });
```

第四个构造器读的不是声明而是观测：`fact()` 读 `AttemptRecord.facts`（生命周期代码经 `ctx.fact()` 上报的运行事实，[字段契约](../../results/architecture.md#facts运行事实)），用来按「这条 attempt 实际连的是哪个实例、实际起步有多少条笔记」分组——这类值不进指纹，换了不作废任何结果，而携带条目带着**产出它那一轮**的 facts，分组因此不会张冠李戴：

```ts
const endpoint = fact("nowledge.endpoint", { label: "Memory instance" });
```

fact 是逐 attempt 的，同一 experiment 的 attempt 可能落在不同值上（跨轮携带、实例中途轮换）；分组按 attempt 各自的值走，不折叠到 experiment 层。experiment 作用域上报的 fact 进 `SnapshotMeta.facts`，不是 attempt 事实，`fact()` 不读它。

`flag()` / `label()` / `runConfig()` / `fact()` 只是分组维度；它们读取的落盘值可能是字符串、数字、布尔值、数组或对象，不冒充数值轴。分组显示键按稳定 JSON 规则生成：字符串直接显示，其它值用对象键递归排序后的 JSON，缺失值显示内置文案 `(missing)`。若不同原始值生成同一个显示键，计算函数报出冲突并要求改用 `CustomDimension`，绝不静默合组。

接受 `SeriesInput` 的选项传数组时解析为**复合维度**：维度 name 为成员 name 依声明顺序以 ` × ` 连接；每个 attempt 的维度值为各成员显示键依同一顺序以 ` · ` 连接，任一成员缺失沿用 `(missing)` 显示键参与连接；显示键冲突检测仍按成员各自执行。`["agent", label("memory")]` 即「agent × 记忆机制」各自成类。

`MetricLine` 的 x 必须是 `NumericAxis`，用 `numericFlag()` / `numericLabel()` / `numericRunConfig()` / `numericFact()` 或自定义 `of` 构造：

```ts
const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
const contextK = numericLabel("contextK", { label: "Context window", unit: "k tokens" });
const concurrency = numericRunConfig("maxConcurrency", { label: "Concurrency" });
const reasoning = numericRunConfig("reasoningEffort", {
  label: "Reasoning effort",
  map: { low: 1, medium: 2, high: 3 },
});
```

`numericFlag(name, options?)` 只接受落盘值为 number 的 flag；`numericLabel(name, options?)` 同理只接受 number 值的 label——labels 由作者亲手声明，要数值轴就直接声明成 number，不设 map；`numericRunConfig(name, options?)` 对数值配置直接返回该值，对字符串配置必须显式给 `map: Record<string, number>`（`reasoningEffort` 这类词表由外部定义，才需要映射）；`numericFact(name, options?)` 只接受落盘值为 number 的 attempt 级 fact（「起步有多少条笔记」这类量,由上报方直接报成数值）。未声明、未投影、非数值或未命中 map 的值返回 `null`，折线不绘该点并报告缺失。

## 相关阅读

- [指标组件](metric-views.md) —— 指标的六种投影。
- [Results Format](../../results/architecture.md) —— 指标读取的落盘字段。
