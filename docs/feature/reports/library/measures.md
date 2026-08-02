# 计算函数、分组与读数值

Reports 的公共计算面由 Reducer、Calculation、分组函数、`aggregate()`、`metricValue()` 与 `evidenceRow()` 组成。
完整形状见[Library · 分组函数与计算函数](../library.md#分组函数与计算函数)；准入边界见 [Calculations](../calculations.md)。

## Calculation

Calculation 是 `rollup()` 产生的函数值。
它定义每条 Attempt 怎样取值，以及题内和跨题分别怎样折叠：

```ts
export const changedLines = rollup(
  async (attempt) => {
    const diff = await attempt.diff();
    return diff ? countChangedLines(diff) : null;
  },
  {
    withinEval: min,
    acrossEvals: mean,
    unit: "lines",
    better: "lower",
  },
);
```

官方与用户 Calculation 走同一条 `rollup()` 路径。
公开入口提供 `mean`、`sum`、`min`、`max` 与 `percentile(p)`；空集合保持 `null`。

## 分组函数

分组以题级单元（Experiment × Eval）为单位。
`aggregate().by` 的分组函数从 `AggregationSubject` 同步返回稳定字符串：

```ts
interface AggregationSubject {
  readonly experimentId: string;
  readonly evalId: string;
  readonly run: Run;
}

agent(subject);
experiment(subject);
evalId(subject);
model(subject);
```

官方函数读固定事实：`experiment` ← `experimentId`，`agent` / `model` ← Run 顶层，flags / labels / 运行配置 ← `run.experiment`。
作者也可以在 `by` 里传普通同步函数，例如：

```ts
by: {
  memory: (subject) =>
    String(subject.run.experiment?.labels?.memory ?? "(missing)"),
}
```

分组函数拿不到 AttemptHandle，因此不可能把同一道题的 attempts 切开。
它们不读取时钟、随机数、网络或文件系统。

## MetricValue

聚合读数使用 MetricValue：

```ts
interface MetricValue {
  value: number | null;
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
  samples: number;
  total: number;
  basis: "attempt" | "eval" | "run" | "pair";
  refs: readonly AttemptLocator[];
}
```

`value: null` 表示缺数据或不适用，不等于零。
`rollup()` 产物固定 `basis: "eval"`：samples / total 数题级单元，`refs` 恒为 Attempt locator。
renderer 根据 `value + format + locale` 格式化，计算函数不生成 display 字符串。

## 官方 Calculation

官方入口至少提供 `passRate`、`costUSD`、`durationMs`、`tokens` 与 `totalScore`。
每个官方 Calculation 都声明 unit、better、bounds 与两个 reducer。
超时样本的耗时下界进入专用耗时 Calculation，不能当作精确 `durationMs` 参与普通均值。

需要报告特有公式时，在报告旁写普通函数。
delta、stability、scoreboard 与 frontier 不因出现在内建报告里就成为公共 Calculation。

## 题型构成与主读数

一个范围的对比主读数由其中出现的题型决定，裁决见[计分粒度](../../assertions/library/score-points.md#横截面聚合同型实验各读各的)。
通过制读通过率，计分制读总分。

题型是定义期事实；同一 experiment 可以同时包含两种题型。
这个选择不依赖任何 attempt 结果，题目一行代码没跑时就有答案。

```ts
type EvaluationKindComposition = "pass" | "points" | "mixed";

const composition = await evaluationKindComposition(sample);
```

`evaluationKindComposition(sample)` 是公开函数；取自 Run 记录的定义期 `evaluationKind`。

**主读数映射是单点规则**，官方消费者都引用这一条，不各自另设判据：

| 构成 | 主读数 | 官方消费面的行为 |
|---|---|---|
| `"pass"` | `passRate` | 摘要主 KPI、实验列表主列、默认散点 y 轴与预排序全用通过率 |
| `"points"` | `totalScore` | 同上位置全部换成总分；通过率不出现（不摆空列） |
| `"mixed"` | 两者并排、各读各的 | 两个 KPI 都显示；按题型拆组后各用自己的主读数 |

`Table` 与图表不感知题型。
分支只发生在首页任务函数、`SampleSummary`、`SampleOverview` 等显式读取该字段的组合里。
自定义报告需要同样切换时，调用同一个 `evaluationKindComposition(sample)`。

题型选择属于报告任务函数，不藏在图表或组件的默认绑定里。
混合题型不能把两种无共同单位的数值压成一个“总分”。

## 维度与数值轴

`aggregate().by` 的官方分组是 `agent`、`model`、`experiment`、`evalId`。
flags、labels 与顶层运行配置从 `subject.run.experiment` 用普通函数读取，不从 experiment id 字符串猜语义。

图表与摘要组合仍接受维度构造器，用来声明离散轴、series 或数值轴身份：

```ts
type RunConfigKey = keyof ExperimentRunInfo | "model" | "agent";

function flag(name: string, options?: DimensionOptions): DimensionRef;
function label(name: string, options?: DimensionOptions): DimensionRef;
function runConfig(name: RunConfigKey, options?: DimensionOptions): DimensionRef;
function numericFlag(name: string, options?: NumericAxisOptions): NumericAxis;
function numericLabel(name: string, options?: NumericAxisOptions): NumericAxis;
function numericRunConfig(
  name: RunConfigKey,
  options?: NumericRunConfigAxisOptions,
): NumericAxis;
```

- `flag()` 读 `ExperimentDefinition.flags`，即 agent / eval 可见的运行参数。
- `label()` 读 `ExperimentDefinition.labels`，即运行时不可见的报告归类标注。
- `runConfig()` 读 Run 的 [`ExperimentRunInfo`](../../record/architecture.md#runjson)投影，外加桥接到顶层的 `model` / `agent`。

labels 的声明语义见[Experiments · labels](../../experiments/library.md#labels声明归类坐标不进运行时)。

```ts
const memory = label("memory");
const webResearch = flag("webResearch");
const reasoning = runConfig("reasoningEffort");
```

`flag()`、`label()` 与 `runConfig()` 只声明分组身份，不冒充数值轴。
数值进程用 `numericFlag` / `numericLabel` / `numericRunConfig`：未声明、非数值或未命中 map 的值返回 `null`，图表不绘该点并报告缺失。

```ts
const budget = numericFlag("budget", { unit: "tokens" });
const reasoning = numericRunConfig("reasoningEffort", {
  map: { low: 1, medium: 2, high: 3 },
});
```

attempt 级 `facts` 不进入 `aggregate().by`：分组主体是题级单元，拿不到单条 Attempt。
要按运行事实筛选或列表，用 `sample.filter`、实体转换或报告旁普通函数。

复合归类把多个维度字段并进 `by` 或图表的 `color` / `point` 键；成员显示键冲突时计算报错，不能静默合组。

## 相关阅读

- [Calculations](../calculations.md) —— 两级聚合、报告旁算法与准入判据。
- [Library](../library.md) —— `aggregate()` 的完整签名与结果推导。
- [格式化](presentation.md) —— MetricValue 的 locale 与轴刻度。
