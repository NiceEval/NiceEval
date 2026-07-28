# 读数与维度

读数定义值与聚合口径，维度定义分组。
[图表](../components/charts/README.md)与[表格](../components/sources/measure.md)只是它们的投影。

## 基础事实与按需字段

Attempt 暴露事实，不预先保存报告公式的结果：

```ts
interface AttemptFacts {
  verdict: "passed" | "failed" | "errored" | "skipped";
  points?: number;
  possiblePoints?: number;
  durationMs?: number;
  usage?: Usage;
  costUSD?: number;
  locator: AttemptLocator;
}
```

`passRate`、`taskPassRate`、`executionReliability` 都不是 Attempt 字段，而是读取这些事实的 Measure。
Source 只计算本次显式选择的 Dimension 与 Measure，输出的 Dataset 也只包含这些字段：

```ts
interface DatasetField {
  name: string;
  kind: "dimension" | "measure";
  valueType: "string" | "number";
  /** 量纲声明，也是格式化的唯一开关。 */
  unit?: string;
  better?: "higher" | "lower";
}

type DatasetValue = string | number | MeasureCell;

interface DatasetRow {
  /** 由全部 dimension 原始值组成的稳定身份，不是数组位置或显示 label。 */
  key: string;
  values: Readonly<Record<string, DatasetValue>>;
}

interface Dataset<Row extends DatasetRow = DatasetRow> {
  fields: readonly DatasetField[];
  rows: readonly Row[];
}

const performance = sources.measure.rows({
  dimensions: ["experiment", "agent"],
  measures: [passRate, costUSD],
});
```

这份 Dataset 只有 `experiment`、`agent`、`passRate`、`costUSD` 四个字段。基础事实加本次选择的
Dimension 和 Measure，才构成当前 Dataset；系统里不存在一份预埋全部派生字段的大对象。

## 公开计算模型

```ts
type ReportInput = Sample;
type Aggregator = "mean" | "sum" | "min" | "max" |
  ((values: readonly number[]) => number);

interface Measure<Name extends string = string> {
  name: Name;
  /** 量纲声明，驱动内建格式化："%" → 87.3%、"ms" → 1.2s、"$" → $0.31、"tokens" → 46.5k tokens。 */
  unit?: string;
  better?: "higher" | "lower";
  /** 读数值的自然边界；图轴留白不得越界。 */
  bounds?: { min?: number; max?: number };
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  /** 同一 experiment × eval 的多个 attempt 先折成题级值；默认 mean。 */
  perEval?: Aggregator;
  /** 题级值再跨 experiment × eval 折成终值；默认 mean。 */
  acrossEvals?: Aggregator;
  /** 覆盖 unit 驱动的内建格式化；只格式化同一个终值，不改变口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

function defineMeasure<const Name extends string>(
  measure: Measure<Name>,
): Measure<Name>;

interface MeasureColumn {
  key: string;
  unit?: string;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
}

interface MeasureCell {
  value: number | null;
  /** 已格式化的显示值；由 measureDisplay() 生成，渲染面直接输出。 */
  display: LocalizedText;
  /** 读数返回非 null 的 attempt 数。 */
  samples: number;
  /** 本格子覆盖的 attempt 总数，包含值为 null 的 attempt。 */
  total: number;
  /** 本格子覆盖的全部 attempt，包含读数值为 null 的证据。 */
  refs: AttemptLocator[];
}
```

`name` 是公式与 Dataset 字段的稳定身份，不是显示文案。内建 Measure 的 name 与导出名相同，
例如 `passRate` 与 `costUSD`；自定义 Measure 原样使用作者给出的 name。Source 不把名称翻译成 label；
`Table` / `Chart` 对内建字段使用自己的呈现词典，自定义字段默认显示原始 name，作者可用
`<Column header>` 或自定义 Component 明确覆盖。

`unit` 是量纲声明，也是格式化的唯一开关；同一个 unit 在图轴、表格与摘要格里折出同一种读法。
显示字符串在计算侧由 `measureDisplay()` 生成一次写进 `MeasureCell.display`，渲染面不重算——
`show` 与 `view` 因此逐字相同，导出的 JSON 也自足。完整规则见
[格式化与呈现工具箱](presentation.md#格式化只发生一次)。

`MeasureCell.refs` 跟随覆盖范围，不只跟随有效样本。用户看到 `samples < total` 时，仍能下钻到
那些“为什么测不了”的 attempt。

跨 Run 计算在分组前先按 Record 身份键去重。题级身份始终是 `experimentId + evalId`；
按 agent 等更宽维度合并多个 experiment 时，不会把不同 experiment 的同名 eval 当成重试。

计算失败与缺数据严格分开:`value()` 对预期缺失返回 `null`;`where`、`value` 或自定义 aggregator
抛错时,当前数据源的 `compute()` 失败。错误带 Measure name、Attempt locator 与 cause,
不把代码错误伪装成“测不了”。非 null 返回值必须是有限数,aggregator 只收到非空数组。

输出顺序是确定的：

- Measure 名在同一数据源的列集合中必须唯一。
- 维度 key 默认按 Unicode 字典序排列。显式排序保持稳定，并以 key 打破同值。
- `refs` 去重后按 AttemptLocator 字典序排列。

只要自定义回调本身是确定的，相同输入与 niceeval 版本就生成字节级稳定的 JSON。

## 内置读数

| 读数 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `passRate` | passed = 1，failed / errored = 0，skipped = `null`；唯一默认通过率 | 高 | `result.json` |
| `taskPassRate` | passed = 1，failed = 0，errored = `null` | 高 | `result.json` |
| `executionReliability` | 可判定 = 1，errored = 0 | 高 | `result.json` |
| `totalScore` | 计分制 eval 的累计挣分 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时；超时返回 `null` | 低 | `result.json` |
| `tokens` | 未缓存输入 + cache read + cache creation + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `assistantTurns` | o11y 事件流中的 assistant turn 数 | 低 | `o11y.json` |
| `repeatedFailedCommands` | 同一失败命令的额外重复次数之和 | 低 | `o11y.json` |

`durationMs` 遇到超时只知道**超时样本的耗时下界**，统计上属于右删失；该线值不是实测完成耗时。

三个通过率读数的 `bounds` 是 `{ min: 0, max: 1 }`。其余内置读数是 `{ min: 0 }`。
计分制分值非负，规则见
[计分粒度](../../assertions/library/score-points.md)；耗时、tokens、成本与计数也天然非负。

`skipped` 对这些读数返回 `null`。`durationMs` 的超时删失也返回 `null`，但删失不能静默。
它会使格子的 `samples` 小于 `total`；渲染层必须保留 `samples`、`total` 与 `refs`，详见
[聚合不变量](../architecture.md#读数聚合不变量)。被超时截断的样本因此以覆盖缺口出现，
不会让“砍掉最慢的样本”伪装成“这个条件更快”。超时线纪律见
[Runner · 超时](../../../runner.md#超时双层保护)。

`errored` 只在 `taskPassRate` 中返回 `null`；在 `passRate` 与
`executionReliability` 中都返回 0。三个读数都先聚合同一 eval 的 attempts，再跨 eval 聚合。
每个 eval 只有一个 attempt 时，`passRate` 才简化为
`passed / (passed + failed + errored)`。

`passRate` 是唯一默认 KPI。默认报告、默认排序和没有限定词的“Pass rate / 通过率”全部只指它。
`taskPassRate` 必须明确标成条件口径，不能把 `2 passed / 5 errored` 显示成无条件的 `100%`。
要定位损失来自答题还是执行，可把三列并排：

```tsx
<Table source={sources.measure.rows({
  dimensions: ["experiment"],
  measures: [passRate, taskPassRate, executionReliability],
  sort: passRate,
})} />
```

`assistantTurns` 与 `repeatedFailedCommands` 需要 `o11y.json`。发布时没复制该 artifact 就显示缺失，
不会冒充 0。

`passRate` 与 Eval 最终 verdict 是两个问题。前者衡量单次实际交付成功的概率；
后者为了 early-exit 和退出码按 `passed > failed > errored > skipped` 折叠多轮。
Reports 可以同时展示两者，但不得用终态判定构成现场重算通过率。

`totalScore` 是通用判定规则的例外：`errored` 与 `skipped` 都记 `null`。基础设施问题不折成 0；
中止挣 0 已经由 `test()` 控制流写进 `points`，读数层不再折一次。通过制 eval 也恒为 `null`，
表示不适用而非缺数据。

它的聚合方向也是例外：`perEval` 用默认 `mean`，`acrossEvals` 用 `sum`。
因此总分是各 eval 挣分之和，跨题不取平均。

## 题型构成与主读数

一个范围的对比主读数由其中出现的题型决定，裁决见
[计分粒度](../../assertions/library/score-points.md#横截面聚合同型实验各读各的)。
通过制读通过率，计分制读总分。

题型是定义期事实；同一 experiment 可以同时包含两种题型。这个选择不依赖任何 attempt 结果，
题目一行代码没跑时就有答案。

```ts
type ScoringComposition = "pass" | "points" | "mixed";
```

这个事实由 [`sources.sample.snapshot`](../components/sources/README.md#snapshot) 的
`scoringComposition` 字段携带，取自 Run 记录的定义期 `scoring`。

**主读数映射是单点规则**，官方消费者都引用这一条，不各自另设判据：

| 构成 | 主读数 | 官方消费面的行为 |
|---|---|---|
| `"pass"` | `passRate` | 摘要主 KPI、实验列表主列、默认散点 y 轴与预排序全用通过率 |
| `"points"` | `totalScore` | 同上位置全部换成总分；通过率不出现（不摆空列） |
| `"mixed"` | 两者并排、各读各的 | 两个 KPI 都显示；按题型拆组后各用自己的主读数 |

Component 保持中立：`Table` 与图表不感知题型。分支只发生在 `SampleSummary`、
`sources.entity.experiments` 与 `SampleOverview` 这些消费该字段的 Source 或组合组件中。
自定义报告需要同样切换时，读同一个字段，不重新发明判据。

## 自定义读数

```ts
import { defineMeasure } from "niceeval/report";

export const changedLines = defineMeasure({
  name: "changed-lines",
  unit: "lines",
  better: "lower",
  where: (attempt) => attempt.result.verdict === "passed",
  async value(attempt) {
    const diff = await attempt.diff();
    if (!diff) return null;
    return Object.keys(diff.files)
      .reduce((sum, path) => sum + (diff.get(path) ?? "").split("\n").length, 0);
  },
  perEval: "min",
  acrossEvals: "mean",
});
```

- `null` 表示测不了，不进入聚合；`0` 表示测得结果为零，会正常进入聚合。
- `where` 是进入计算前的显式条件，适合“只比较通过方案的代码量”。
- 聚合先折叠同一 experiment × eval 的 attempts，再跨题折叠；`perEval` 与 `acrossEvals` 默认都是 `mean`。
- `unit` 驱动显示值的生成，`display` 覆盖它。多语言只改变显示，不分裂数值。

## 维度与数值轴

可直接使用的维度有 `agent`、`model`、`experiment`、`eval`、`evalGroup` 和 `run`。
`evalGroup` 取 eval id 的完整父路径；没有 `/` 时取完整 id。比如 `security/sql-injection`
归 `security`，`a/b/c` 归 `a/b`。它只组织 eval，不组织 experiment。完整形状是：

```ts
type BuiltInDimension =
  | "agent" | "model" | "experiment" | "eval" | "evalGroup" | "run";

interface CustomDimension {
  name: string;
  of(attempt: AttemptHandle): string;
}

interface DimensionRef {
  readonly kind: "flag" | "runConfig" | "label" | "fact";
  readonly name: string;
  readonly unit?: string;
}

type SingleDimension = BuiltInDimension | CustomDimension | DimensionRef | NumericDimension;

/** 非空数组解析为复合维度；所有维度位置都接受它。 */
type DimensionInput = SingleDimension | readonly [SingleDimension, ...SingleDimension[]];

interface NumericDimension {
  name: string;
  unit?: string;
  of(attempt: AttemptHandle): number | null;
}

interface DimensionOptions {
  unit?: string;
}

interface NumericDimensionOptions extends DimensionOptions {}

interface NumericRunConfigDimensionOptions extends NumericDimensionOptions {
  /** 字符串配置到数值轴的显式映射；数值配置不需要。 */
  map?: Readonly<Record<string, number>>;
}

/** ExperimentRunInfo 字段，外加 Run 顶层的 model / agent。 */
type RunConfigKey = keyof ExperimentRunInfo | "model" | "agent";

function flag(name: string, options?: DimensionOptions): DimensionRef;
function label(name: string, options?: DimensionOptions): DimensionRef;
function runConfig(name: RunConfigKey, options?: DimensionOptions): DimensionRef;
function fact(name: string, options?: DimensionOptions): DimensionRef;
function numericFlag(name: string, options?: NumericDimensionOptions): NumericDimension;
function numericLabel(name: string, options?: NumericDimensionOptions): NumericDimension;
function numericRunConfig(name: RunConfigKey, options?: NumericRunConfigDimensionOptions): NumericDimension;
function numericFact(name: string, options?: NumericDimensionOptions): NumericDimension;
```

自定义维度：

```ts
const verdictFamily = {
  name: "verdict-family",
  of: (attempt) => attempt.result.verdict === "passed" ? "pass" : "needs-work",
};
```

experiment 中声明的变量用对应构造器读取，不从 experiment id 字符串猜：

- `flag()` 读 `ExperimentDef.flags`，即 agent / eval 可见的运行参数。
- `label()` 读 `ExperimentDef.labels`，即运行时不可见的报告归类标注。
- `runConfig()` 读顶层运行配置。

labels 的声明语义见
[Experiments · labels](../../experiments/library.md#labels声明归类坐标不进运行时)。

```ts
const memory = label("memory");
const webResearch = flag("webResearch");
```

`model`、`reasoningEffort`、`budget`、`attempts` 这类顶层运行配置不在 `flags` 里。
`runConfig()` 读取 Run 的 [`ExperimentRunInfo`](../../record/architecture.md#runjson) 投影，
不是项目的 `niceeval.config.ts`。`RunConfigKey` 在类型层穷尽可用键，拼错会在编译期被拒绝：

```ts
const reasoning = runConfig("reasoningEffort");
const budget = runConfig("budget", { unit: "USD" });
```

第四个构造器读观测而非声明。`fact()` 读 `AttemptRecord.facts`，用来按实际实例或起步状态分组；
字段契约见 [facts](../../record/architecture.md#facts运行事实)。这类值不进指纹，变化不会作废结果。
携带条目保留产出轮次的 facts，因此分组不会张冠李戴：

```ts
const endpoint = fact("nowledge.endpoint");
```

fact 是逐 attempt 的，同一 experiment 的 attempts 可以落在不同值上。分组按各自值进行，
不折叠到 experiment 层。experiment 作用域的 fact 进入 `RunMeta.facts`；`fact()` 不读它。

`flag()`、`label()`、`runConfig()` 与 `fact()` 只是分组维度，不冒充数值轴。
字符串直接显示；其它值使用对象键递归排序后的稳定 JSON；缺失值显示 `(missing)`。
不同原始值若生成同一个显示键，计算必须报冲突并要求改用 `CustomDimension`，不能静默合组。

维度数组解析为**复合维度**。成员 name 以 ` × ` 连接，成员显示键以 ` · ` 连接；
缺失成员用 `(missing)`。冲突检测仍逐成员执行。比如
`["agent", label("memory")]` 表示“agent × 记忆机制”。

复合维度可以交给 `sources.measure.rows({ dimensions })`，生成一个稳定的复合 dimension field。
Chart 再按字段名把它绑定为离散轴或 series。

数值维度使用 `NumericDimension`，同样进入 `sources.measure.rows({ dimensions })`。Dataset field 会标明
数值语义，Chart 按字段名绑定成数值轴。内建构造器是 `numericFlag()` / `numericLabel()` /
`numericRunConfig()` / `numericFact()`：

```ts
const budget = numericFlag("budget", { unit: "tokens" });
const contextK = numericLabel("contextK", { unit: "k tokens" });
const concurrency = numericRunConfig("maxConcurrency");
const reasoning = numericRunConfig("reasoningEffort", {
  map: { low: 1, medium: 2, high: 3 },
});
```

这些构造器的输入规则如下：

- `numericFlag()` 与 `numericLabel()` 只接受 number；label 要做数值轴就直接声明为 number。
- `numericRunConfig()` 直接读取数值配置；字符串配置必须提供显式 `map`。
- `numericFact()` 只接受 number 类型的 attempt fact。

未声明、未投影、非数值或未命中 map 的值返回 `null`；图表不绘该点，并报告缺失。

## 相关阅读

- [图表](../components/charts/README.md) / [Measure 数据源](../components/sources/measure.md) —— 读数的图形与表格投影。
- [格式化与呈现工具箱](presentation.md) —— `unit` 折成什么字符串、`display` 由谁生成。
- [Record Format](../../record/architecture.md) —— 读数读取的落盘字段。
