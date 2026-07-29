# 计算函数、分组与读数值

Reports 的公共计算面由 Reducer、Calculation、分组函数、`aggregate()`、
`metricValue()` 与 `evidenceRow()` 组成。完整形状见
[Library · 分组函数与计算函数](../library.md#分组函数与计算函数)；
准入边界见 [Calculations](../calculations.md)。

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
公开入口提供 `mean`、`sum`、`min`、`max` 与 `percentile(p)`；
空集合保持 `null`。

## 分组函数

分组函数从 AttemptHandle 同步返回稳定字符串：

```ts
agent(attempt);
experiment(attempt);
evalId(attempt);
model(attempt);
run(attempt);
verdict(attempt);
```

作者也可以在 `aggregate()` 的 `by` 中传普通同步函数。
分组函数不读取时钟、随机数、网络或文件系统。

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
`samples`、`total` 与 `basis` 解释分母，`refs` 支持下钻。
renderer 根据 `value + format + locale` 格式化，计算函数不生成 display 字符串。

## 官方 Calculation

官方入口至少提供 `passRate`、`costUSD` 与 `durationMs`，
以及仓库其它已定稿的 Attempt 标量读数。
每个官方 Calculation 都声明 unit、better、bounds 与两个 reducer。
超时样本的耗时下界进入专用耗时 Calculation，不能当作精确 `durationMs` 参与普通均值。

需要报告特有公式时，在报告旁写普通函数。
delta、stability、scoreboard 与 frontier 不因出现在内建报告里就成为公共 Calculation。

## 题型与主读数

通过制报告通常用 `passRate`，计分制报告使用该 Eval 定义的官方计分 Calculation。
混合题型不能把两种无共同单位的数值压成一个“总分”。
内建报告可以按题型分别显示，或要求作者为业务场景显式提供归一化公式。

题型选择属于报告任务函数，不藏在图表或组件的默认绑定里。

## 相关阅读

- [Calculations](../calculations.md) —— 两级聚合、报告旁算法与准入判据。
- [Library](../library.md) —— `aggregate()` 的完整签名与结果推导。
- [格式化](presentation.md) —— MetricValue 的 locale 与轴刻度。
