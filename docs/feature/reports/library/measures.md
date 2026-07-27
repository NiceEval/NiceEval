# 读数与维度

读数定义值与聚合口径，维度定义分组。
[图表](../components/charts/README.md)与[表格](../components/tables/README.md)只是它们的投影。

## 公开计算模型

```ts
type ReportInput = Sample | readonly Run[];
type Aggregator = "mean" | "sum" | "min" | "max" |
  ((values: readonly number[]) => number);

interface MeasureAggregate {
  /** 同一 experiment × eval 的多个 attempt 先折成题级值；默认 mean。 */
  perEval?: Aggregator;
  /** 题级值再跨 experiment × eval 折成终值；默认 mean。 */
  acrossEvals?: Aggregator;
}

interface Measure<Name extends string = string> {
  name: Name;
  /** 省略时使用 name；渲染面按 locale 选择。 */
  label?: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  better?: "higher" | "lower";
  /** 读数值的自然边界；图轴留白不得越界。 */
  bounds?: { min?: number; max?: number };
  where?: (attempt: AttemptHandle) => boolean;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
  aggregate?: MeasureAggregate;
  /** 只格式化同一个终值，不按 locale 分裂计算口径。 */
  display?: (value: number, locale: ReportLocale) => string;
}

function defineMeasure<const Name extends string>(
  measure: Measure<Name>,
): Measure<Name>;

interface MeasureColumn {
  key: string;
  label: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
}

interface MeasureCell {
  value: number | null;
  /** 各官方 locale 的显示值；renderer 按 LocalizedText 规则回退。 */
  display: LocalizedText;
  /** 读数返回非 null 的 attempt 数。 */
  samples: number;
  /** 本格子覆盖的 attempt 总数，包含值为 null 的 attempt。 */
  total: number;
  /** 本格子覆盖的全部 attempt，包含读数值为 null 的证据。 */
  refs: AttemptLocator[];
}
```

`MeasureCell.refs` 跟随覆盖范围，不只跟随有效样本。用户看到 `samples < total` 时，仍能下钻到
那些“为什么测不了”的 attempt。

跨 Run 计算在分组前先按 Record 身份键去重。题级身份始终是 `experimentId + evalId`；
按 agent 等更宽维度合并多个 experiment 时，不会把不同 experiment 的同名 eval 当成重试。

计算失败与缺数据严格分开:`value()` 对预期缺失返回 `null`;`where`、`value`、自定义 aggregator 或
`display` 抛错时,当前数据源的 `compute()` 失败。错误带 Measure name、Attempt locator 与 cause,
不把代码错误伪装成“测不了”。非 null 返回值必须是有限数,aggregator 只收到非空数组。

输出顺序是确定的：

- Measure 名在同一数据源的列集合中必须唯一。
- 维度 key 默认按 Unicode 字典序排列。显式排序保持稳定，并以 key 打破同值。
- `refs` 去重后按 AttemptLocator 字典序排列。

只要自定义回调本身是确定的，相同输入与 niceeval 版本就生成字节级稳定的 JSON。

## 内置读数

| 读数 | 含义 | 越高/低越好 | 数据来源 |
|---|---|---|---|
| `endToEndPassRate` | passed = 1，其余判定 = 0 | 高 | `result.json` |
| `taskPassRate` | passed = 1，failed = 0，errored = `null` | 高 | `result.json` |
| `executionReliability` | 可判定 = 1，errored = 0 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `totalScore` | 计分制 eval 的累计挣分 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时；超时返回 `null` | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `assistantTurns` | o11y 事件流中的 assistant turn 数 | 低 | `o11y.json` |
| `repeatedFailedCommands` | 同一失败命令的额外重复次数之和 | 低 | `o11y.json` |

`durationMs` 遇到超时只知道**超时样本的耗时下界**，统计上属于右删失；该线值不是实测完成耗时。

三个通过率读数与 `examScore` 的 `bounds` 是 `{ min: 0, max: 1 }`；质量分是 soft 断言的均值。
其余内置读数是 `{ min: 0 }`。计分制分值非负，规则见
[计分粒度](../../scoring/library/score-points.md)；耗时、tokens、成本与计数也天然非负。

`skipped` 对这些读数返回 `null`。`durationMs` 的超时删失也返回 `null`，但删失不能静默。
它会使格子的 `samples` 小于 `total`；渲染层必须保留 `samples`、`total` 与 `refs`，详见
[聚合不变量](../architecture.md#读数聚合不变量)。被超时截断的样本因此以覆盖缺口出现，
不会让“砍掉最慢的样本”伪装成“这个条件更快”。超时线纪律见
[Runner · 超时](../../../runner.md#超时双层保护)。

`errored` 只在 `taskPassRate` 中返回 `null`；在 `endToEndPassRate` 与
`executionReliability` 中都返回 0。三个读数都先聚合同一 eval 的 attempts，再跨 eval 聚合。
每个 eval 只有一个 attempt 时，`endToEndPassRate` 才简化为
`passed / (passed + failed + errored)`。

它的完整口径名是“End-to-end pass rate / 端到端通过率”，默认可见短标签是
“Pass rate / 通过率”。只写这个短标签的位置都必须使用 `endToEndPassRate`。
`taskPassRate` 必须明确标成条件口径，不能把 `2 passed / 5 errored` 显示成无条件的 `100%`。
要定位损失来自答题还是执行，可把三列并排：

```tsx
<Table source={measureRows({
  rows: "experiment",
  measures: [endToEndPassRate, taskPassRate, executionReliability],
  sort: endToEndPassRate,
})} />
```

`assistantTurns` 与 `repeatedFailedCommands` 需要 `o11y.json`。发布时没复制该 artifact 就显示缺失，
不会冒充 0。

`endToEndPassRate` 与 Eval 最终 verdict 是两个问题。前者衡量单次实际交付成功的概率；
后者为了 early-exit 和退出码按 `passed > failed > errored > skipped` 折叠多轮。
Reports 可以同时展示两者，但不得用终态判定构成现场重算通过率。

`totalScore` 是通用判定规则的例外：`errored` 与 `skipped` 都记 `null`。基础设施问题不折成 0；
中止挣 0 已经由 `test()` 控制流写进 `points`，读数层不再折一次。通过制 eval 也恒为 `null`，
表示不适用而非缺数据。

它的聚合方向也是例外：`perEval` 用默认 `mean`，`acrossEvals` 用 `sum`。
因此总分是各 eval 挣分之和，跨题不取平均。

## 题型构成与主读数

一个范围的对比主读数由其中出现的题型决定，裁决见
[计分粒度](../../scoring/library/score-points.md#横截面聚合同型实验各读各的)。
通过制读通过率，计分制读总分。

题型是定义期事实；单个 experiment 内由启动期强制同型。这个选择不依赖任何 attempt 结果，
题目一行代码没跑时就有答案。

```ts
type ScoringComposition = "pass" | "points" | "mixed";

/** input 内出现的题型构成，取自 Run 记录的定义期 `scoring` 事实。 */
function scoringComposition(input: ReportInput): Promise<ScoringComposition>;
```

**主读数映射是单点规则**，官方消费者都引用这一条，不各自另设判据：

| 构成 | 主读数 | 官方消费面的行为 |
|---|---|---|
| `"pass"` | `endToEndPassRate` | 摘要主 KPI、实验列表主列、默认散点 y 轴与预排序全用通过率 |
| `"points"` | `totalScore` | 同上位置全部换成总分；通过率不出现（不摆空列） |
| `"mixed"` | 两者并排、各读各的 | 两个 KPI 都显示；按题型拆组后各用自己的主读数 |

原语保持中立:`Table` 与图表不感知题型。分支只发生在 `sampleSummary(...)`、`experimentRows` 与
`SampleOverview` 这些消费 `scoringComposition` 的数据源或组合组件中。自定义报告需要同样切换时,
调用同一个函数,不重新发明判据。

## 自定义读数

```ts
import { defineMeasure } from "niceeval/report";

export const changedLines = defineMeasure({
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
- 聚合先折叠同一 experiment × eval 的 attempts，再跨题折叠；两级默认都是 `mean`。
- `unit` 驱动内置格式化；特殊显示用 `display(value, locale)`。多语言只改变显示，不分裂数值。

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
  readonly label?: LocalizedText;
  readonly unit?: string;
}

type SingleDimension = BuiltInDimension | CustomDimension | DimensionRef;

/** 非空数组解析为复合维度；所有维度位置都接受它。 */
type DimensionInput = SingleDimension | readonly [SingleDimension, ...SingleDimension[]];

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

/** ExperimentRunInfo 字段，外加 Run 顶层的 model / agent。 */
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

experiment 中声明的变量用对应构造器读取，不从 experiment id 字符串猜：

- `flag()` 读 `ExperimentDef.flags`，即 agent / eval 可见的运行参数。
- `label()` 读 `ExperimentDef.labels`，即运行时不可见的报告归类标注。
- `runConfig()` 读顶层运行配置。

labels 的声明语义见
[Experiments · labels](../../experiments/library.md#labels声明归类坐标不进运行时)。

```ts
const memory = label("memory", { label: "Memory mechanism" });
const webResearch = flag("webResearch", { label: "Web research" });
```

`model`、`reasoningEffort`、`budget`、`attempts` 这类顶层运行配置不在 `flags` 里。
`runConfig()` 读取 Run 的 [`ExperimentRunInfo`](../../record/architecture.md#runjson) 投影，
不是项目的 `niceeval.config.ts`。`RunConfigKey` 在类型层穷尽可用键，拼错会在编译期被拒绝：

```ts
const reasoning = runConfig("reasoningEffort", { label: "Reasoning effort" });
const budget = runConfig("budget", { label: "Budget", unit: "USD" });
```

第四个构造器读观测而非声明。`fact()` 读 `AttemptRecord.facts`，用来按实际实例或起步状态分组；
字段契约见 [facts](../../record/architecture.md#facts运行事实)。这类值不进指纹，变化不会作废结果。
携带条目保留产出轮次的 facts，因此分组不会张冠李戴：

```ts
const endpoint = fact("nowledge.endpoint", { label: "Memory instance" });
```

fact 是逐 attempt 的，同一 experiment 的 attempts 可以落在不同值上。分组按各自值进行，
不折叠到 experiment 层。experiment 作用域的 fact 进入 `RunMeta.facts`；`fact()` 不读它。

`flag()`、`label()`、`runConfig()` 与 `fact()` 只是分组维度，不冒充数值轴。
字符串直接显示；其它值使用对象键递归排序后的稳定 JSON；缺失值显示 `(missing)`。
不同原始值若生成同一个显示键，计算必须报冲突并要求改用 `CustomDimension`，不能静默合组。

维度数组解析为**复合维度**。成员 name 以 ` × ` 连接，成员显示键以 ` · ` 连接；
缺失成员用 `(missing)`。冲突检测仍逐成员执行。比如
`["agent", label("memory")]` 表示“agent × 记忆机制”。

复合维度在收维度的每个位置都合法，没有「只有 series 能复合」的例外。比如
`measureRows({ rows: ["agent", label("memory")], ... })` 与
`chart({ x: { dimension: ["agent", label("memory")] }, ... })` 解析出同一个维度，只是投影成行或轴。

`chart()` 的数值轴绑定必须是 `NumericAxis`，用 `numericFlag()` / `numericLabel()` /
`numericRunConfig()` / `numericFact()` 或自定义 `of` 构造：

```ts
const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
const contextK = numericLabel("contextK", { label: "Context window", unit: "k tokens" });
const concurrency = numericRunConfig("maxConcurrency", { label: "Concurrency" });
const reasoning = numericRunConfig("reasoningEffort", {
  label: "Reasoning effort",
  map: { low: 1, medium: 2, high: 3 },
});
```

这些构造器的输入规则如下：

- `numericFlag()` 与 `numericLabel()` 只接受 number；label 要做数值轴就直接声明为 number。
- `numericRunConfig()` 直接读取数值配置；字符串配置必须提供显式 `map`。
- `numericFact()` 只接受 number 类型的 attempt fact。

未声明、未投影、非数值或未命中 map 的值返回 `null`；图表不绘该点，并报告缺失。

## 相关阅读

- [图表](../components/charts/README.md) / [表格与矩阵](../components/tables/README.md) —— 读数的图形与表格投影。
- [Record Format](../../record/architecture.md) —— 读数读取的落盘字段。
