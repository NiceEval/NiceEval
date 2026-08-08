# Experiment scatter

`ExperimentScatter` 是默认的实验比较图：

```tsx
<ExperimentScatter />
```

它从显式 `input` 或当前 `ctx.scope` 读取 Sample，按 Experiment 聚合：

- x 轴恒为 `costUSD`；
- 通过制的 y 轴为 `passRate`；
- 计分制的 y 轴为 `totalScore`；
- 混合 Sample 分成两张图，不把通过率和分数画在同一坐标轴；
- 点身份是 Experiment；
- 点目标是该实验的 [experiment 详情页](../experiment-detail/README.md)，报告没有 `experiment` 页时点是纯图形；
- series 默认优先使用 `labels.line`，没有 line 时使用 agent。

`series`、`connect` 与 `pointTarget` 可以替换默认归类、连线与下钻策略。
组件只负责默认比较口径；需要其它轴或粒度时直接使用 `aggregate()` 与 `Scatter`。
