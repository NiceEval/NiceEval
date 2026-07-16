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
  /** 一个组内的题级值再折成终值；默认 mean。 */
  across?: Aggregator;
}

interface Metric<Name extends string = string> {
  name: Name;
  /** 省略时使用 name；渲染面按 locale 选择。 */
  label?: LocalizedText;
  description?: LocalizedText;
  unit?: string;
  better?: "higher" | "lower";
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
}

interface MetricCell {
  value: number | null;
  /** 计算函数为每个受支持 locale 生成显示值，renderer 再选择。 */
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
| `endToEndPassRate` | 默认成功率：passed = 1，failed / errored = 0，回答实际交付成功结果的概率 | 高 | `result.json` |
| `taskPassRate` | 条件答题通过率：passed = 1，failed = 0，errored 记 `null`；即只在已形成可信判定的样本上回答 Agent 答题质量 | 高 | `result.json` |
| `executionReliability` | 执行可靠性：跑到可判定（passed / failed）= 1，errored = 0；回答一次运行能否形成可信判定 | 高 | `result.json` |
| `examScore` | gate 决定能否得分，soft 断言给质量分 | 高 | `result.json` |
| `durationMs` | attempt 判定链耗时（不含收尾段，口径见 [Results](../../results/architecture.md#resultjson)） | 低 | `result.json` |
| `tokens` | input + output tokens | 低 | `result.json` |
| `costUSD` | 网关实测成本优先，否则估算成本 | 低 | `result.json` |
| `turns` | assistant turn 数 | 低 | `o11y.json` |

`skipped` 对这些指标返回 `null`。`errored` 只在 `taskPassRate` 中返回 `null`，在默认 `endToEndPassRate` 与 `executionReliability` 中都返回 0。三个指标都遵守“先在同一 eval 的 attempts 内聚合，再跨 eval 聚合”的两级规则；每个 eval 只有一个 attempt 时，`endToEndPassRate` 才简化为 `passed / (passed + failed + errored)`。三个指标必须按名字展示：任何默认总览和任何只写“Pass rate / 成功率”的位置都使用 `endToEndPassRate`；`taskPassRate` 必须标成“Task pass rate / 可判定任务通过率”等条件口径，不能把 `2 passed / 5 errored` 显示成无条件的 `100%`。要定位损失来自答题还是执行，可把三列并排：

```tsx
<MetricTable
  rows="experiment"
  columns={[endToEndPassRate, taskPassRate, executionReliability]}
  sort={endToEndPassRate}
/>
```

`turns` 需要 `o11y.json`；发布时没复制该 artifact 就显示缺失，不会冒充 0。`endToEndPassRate` 与 Eval 最终 verdict 是两个问题：前者衡量单次实际交付成功的概率；后者为了 early-exit / 退出码按 `passed > failed > errored > skipped` 折叠多轮。Reports 可以同时展示终态判定构成和 `endToEndPassRate`，但不得用前者现场重算后者。

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
  aggregate: { perEval: "min", across: "mean" },
});
```

- `null` 表示测不了，不进入聚合；`0` 表示测得结果为零，会正常进入聚合。
- `where` 是进入计算前的显式条件，适合“只比较通过方案的代码量”。
- 聚合先在同一 experiment × eval 的多个 attempt 之间折叠，再跨 experiment × eval 折叠；两级默认都是 `mean`。
- `unit` 驱动内置格式化；需要特殊显示时提供 `display(value, locale)`。计算函数为所有受支持 locale 生成 `MetricCell.display`，数值仍只有一个 `value`。

## 维度与数值轴

可直接使用的维度有 `agent`、`model`、`experiment`、`eval`、`evalGroup` 和 `snapshot`。完整形状是：

```ts
type BuiltInDimension =
  | "agent" | "model" | "experiment" | "eval" | "evalGroup" | "snapshot";

interface CustomDimension {
  name: string;
  of(attempt: AttemptHandle): string;
}

interface DimensionRef {
  readonly kind: "flag" | "config";
  readonly name: string;
  readonly label?: LocalizedText;
  readonly unit?: string;
}

type DimensionInput = BuiltInDimension | CustomDimension | DimensionRef;

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

interface NumericConfigAxisOptions extends NumericAxisOptions {
  /** 字符串配置到数值轴的显式映射；数值配置不需要。 */
  map?: Readonly<Record<string, number>>;
}

function flag(name: string, options?: DimensionOptions): DimensionRef;
function config(name: string, options?: DimensionOptions): DimensionRef;
function numericFlag(name: string, options?: NumericAxisOptions): NumericAxis;
function numericConfig(name: string, options?: NumericConfigAxisOptions): NumericAxis;
```

自定义维度：

```ts
const verdictFamily = {
  name: "verdict-family",
  of: (attempt) => attempt.result.verdict === "passed" ? "pass" : "needs-work",
};
```

experiment 中声明的变量用 `flag()` 读取，不从 experiment id 字符串猜。`flag()` 只读 `ExperimentDef.flags` 里显式声明的 KV，用于分组：

```ts
const memory = flag("memory", { label: "Memory mode" });
```

`model`、`reasoningEffort`、`budget`、`runs` 这类**顶层运行配置不在 `flags` 里**，用 `config()` 读快照的 [`ExperimentRunInfo`](../../results/architecture.md#snapshotjson) 投影——可用键是那张接口的字段全集，外加桥接到快照顶层权威字段的 `model` / `agent` 两个键：

```ts
const reasoning = config("reasoningEffort", { label: "Reasoning effort" });
const budget = config("budget", { label: "Budget", unit: "USD" });
```

`flag()` / `config()` 只是分组维度；它们读取的 JSON 值可能是字符串、数字、布尔值、数组或对象，不冒充数值轴。分组显示键按稳定 JSON 规则生成：字符串直接显示，其它值用对象键递归排序后的 JSON，缺失值显示内置文案 `(missing)`。若不同原始值生成同一个显示键，计算函数报出冲突并要求改用 `CustomDimension`，绝不静默合组。`MetricLine` 的 x 必须是 `NumericAxis`，用 `numericFlag()` / `numericConfig()` 或自定义 `of` 构造：

```ts
const budget = numericFlag("budget", { label: "Token budget", unit: "tokens" });
const concurrency = numericConfig("maxConcurrency", { label: "Concurrency" });
const reasoning = numericConfig("reasoningEffort", {
  label: "Reasoning effort",
  map: { low: 1, medium: 2, high: 3 },
});
```

`numericFlag(name, options?)` 只接受落盘值为 number 的 flag；`numericConfig(name, options?)` 对数值配置直接返回该值，对字符串配置必须显式给 `map: Record<string, number>`。未声明、未投影、非数值或未命中 map 的值返回 `null`，折线不绘该点并报告缺失。

## 相关阅读

- [指标组件](metric-views.md) —— 指标的六种投影。
- [Results Format](../../results/architecture.md) —— 指标读取的落盘字段。
