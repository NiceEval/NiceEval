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
- series 默认优先使用 `labels.line`，没有 line 时使用 agent。

`series` 与 `connect` 可以覆盖默认归类和连线策略。
组件只负责默认比较口径；需要其它轴或粒度时直接使用 `aggregate()` 与 `Scatter`。
