# 报告作者 API —— 计算边界

本篇定义哪些计算进入公共 Reports 内核，哪些留在某份报告旁。
完整调用形状见 [Library](library.md)。

## 内核保留五类值

公共计算面只保留以下角色：

```ts
mean;
sum;
min;
max;
percentile(0.95);

defineCalculation;
rollup;
aggregate;
metricValue;
evidenceRow;

MeasureCell;
MetricValue;
EvidenceValue;
```

- Projector 由 Record 的 `defineAttemptProjector<Input, Params, T>()` 声明事实读取与 provenance；
- Projector 同时声明规范化 defaults、实际 object dependencies，并从 `projectNormalized()` 返回 raw `T`；
- Calculation 声明静态 projector dependency、canonical JSON configuration 与纯 evaluate；
- rollup 声明 group 内、group 间和 unavailable policy；
- aggregate 把 Sample membership 转成带顶层 coverage 的 AggregateResult；
- MetricValue 与 EvidenceRow 是复杂算法的证据终点。

公共内核不因为一张报告需要它就新增 `history()`、`delta()`、`stability()`、`pivot()` 或 `frontier()`。

## Reducer 是函数，不是字符串

```ts
const p95DurationMs = rollup(durationMs, {
  withinEval: percentile(0.95),
  acrossEvals: mean,
  unavailable: "exclude",
});
```

`mean`、`sum`、`min`、`max` 与 `percentile(p)` 都是纯函数。
它们只接收已经被 rollup policy 纳入的 available 值；不能把 unavailable 改写成 `null`、零或空数组。

`percentile(p)` 接受闭区间 `[0, 1]`，对有序样本做稳定线性插值。
count 或 distinct 必须先声明 identity、分母和 unavailable policy，因此不作为无主语 reducer 提供。

## Sample 不增加 map

Sample 负责固定比较总体、coverage、membership 与 provenance。
它提供的范围改变会生成固定选择：

```ts
const security = narrowSample(sample, {
  experiments: ["compare/"],
  evals: ["security/"],
});
```

Sample 不提供 map、groupBy、reduce、pipe 或任意 predicate callback。
这些操作会让结果脱离完整 source 集合、分母和 membership proof。

需要分组或数值，使用 `aggregate()`；需要普通展示结构，使用已交付 ReportData 上的纯转换。
`aggregate()` request 在 ReportData 中得到的是 `EvidenceValue<AggregateResult>`，不是 rows；组件只在
available 分支消费 `value.rows`，并保留 `value.coverage` 与最外层 evidence metadata。

## 报告旁算法不退出证据契约

成对差异、稳定性和固定题集成绩单不能强行写入通用 rollup。
它们仍必须从已计划的 MeasureCell 和 EvidenceValue 出发：

```ts
interface DeltaPoint {
  readonly baseline: MeasureCell<number>;
  readonly candidate: MeasureCell<number>;
  readonly delta: EvidenceValue<number>;
}

function pairedDelta(
  baseline: readonly MeasureCell<number>[],
  candidate: readonly MeasureCell<number>[],
): readonly DeltaPoint[] {
  // 按明确 identity 配对；保留两个输入的 EvidenceValue。
}
```

`MeasureCell` 与 `EvidenceValue` 分别由 [Reports Library](library.md#分组函数与计算函数) 和 [Record Library](../record/library.md#evidencevaluevalue-与-verification-两轴) owner 定义；`DeltaPoint` 只属于这个报告旁算法示例。

结束时使用 `metricValue()` 与 `evidenceRow()`。
这两项要求算法明确 coverage、refs 和 EvidenceValue，而非返回 bare number 或把不可用输入抹成空值。
`evidenceRow()` 额外要求所有自定义字段属于 `ReportJsonObject`；任意 class instance、Date、Map、
函数或 `undefined` 不因“是 object”就能进入结果行。

## 历史是另一份固定选择

趋势、时间线和回归比较需要一个明确的图版本与成员集合。
报告把它作为单独 materialized Sample 或显式的 Sample union 交给 plan，而不是让一个 `history()` 函数在 render 时扫描 Record。

这样每个历史点都有完整 source Graph 集合、adopted revision 和 membership proof。
如果选择策略改变，就产生新的 Sample identity 和新的 ReportPlan。

## `scoreboard` 是模式，不是 API

成绩单的固定题集、权重、满分和不计分 policy 属于业务契约。
它可在报告旁用已计划的 MeasureCell 写成纯函数：

```ts
const scoreboard = calculateScoreboard(cells, rubric);
const total = metricValue({
  result: scoreboard.evidence,
  coverage: scoreboard.coverage,
  refs: scoreboard.refs,
  unit: "points",
});
```

缺题仍保留在 coverage；已有依据继续留在 refs。
只有多个独立报告具有相同输入、公式和输出语义时，才考虑把一个算法提升到公共内核。

## `delta`、`stability` 与 `frontier` 留在报告旁

这些名字没有跨产品统一的比较键、阈值或展示结果。
它们的合法形态是纯函数：输入是 Plan 已经声明的 ReportData，输出是带 EvidenceValue 的结果值。

它们不能在 renderer 中读取新的 projector，不能依赖原始事件 schema，也不能把缺失一侧从分母中悄悄删除。

## 报告组件不认识计算名

`Col`、`Table`、`Bars`、`Scatter` 与 `Stat` 只认识已经建立的 props 值。Table 与图表的 aggregate
overload 认识完整 AggregateData，先判别外层 EvidenceValue，再读取 AggregateResult；它们不接未包装的
`aggregate().value.rows` 逃生形状。
它们不知道一个点来自 pass rate、delta、scoreboard 或外部 snapshot，也不会触发计算。

这条边界让新增分析先成为纯 Calculation 或报告旁函数，而不是扩张组件目录或建立第二种查询语言。

## 计算的准入判据

新函数进入公共计算内核前必须同时满足：

1. 至少三个独立报告需要相同输入、公式与输出语义。
2. 普通实现容易产生看似合理、却遗漏 coverage 或 evidence 的错误。
3. 它能用静态 Projector dependency、纯 Calculation 与 EvidenceValue 表达。
4. 官方报告与用户报告调用同一个公开实现。

不满足时，函数留在使用它的报告旁。

## 组件的准入判据

组件目录按显示形状增长，不按领域问题增长：

1. **原语**：text 与 web 都有现有组合无法表达的显示逻辑。
2. **糖组件**：只组合同步纯投影和原语，不能改变数值或证据资格。
3. **其余内容**：领域计算是 Calculation 或报告旁函数；页面装配属于 ReportPlan；呈现偏好属于现有 props。

自定义 renderer 必须消费已冻结的值，不能向 plan、executor 或 Store 反向请求数据。
