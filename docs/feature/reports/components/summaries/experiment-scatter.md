# Experiment scatter

`ExperimentScatter` 显示 page data 中已经建立的实验比较 points：

```tsx
<ExperimentScatter points={points} />
```

`points` 的类型是按 experiment 分组的完整 `AggregateData`，不是 AggregateRow 数组。外层
unavailable 显示 causes 与 basedOn；available 才消费 `value.rows`，并把 `value.coverage.unavailable`
显示为无法归入 experiment 的明确缺口。

页面在 plan 中声明成本、主读数、coverage 和 experiment target；组件只做以下显示决定：

- x 轴显示已建立的成本 MetricValue；
- y 轴显示同一计划中已建立的主读数 MetricValue；
- 混合题型分图显示，不合并没有共同单位的 metrics；
- 目标只指向已枚举的 experiment page instance；
- series 与连线只读取冻结 provenance 或已交付 dimensions。

需要其它轴或粒度时，在 plan 中声明另一个 aggregate 或 Projector request，再把结果交给 `Scatter`。
