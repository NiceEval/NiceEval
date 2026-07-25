# 概览

回答「这批结果有多大、整体是否健康、当前水位在哪」的两个层次：`ScopeSummary` 是有 `scopeSummaryData` 的叶子数据组件；`ExperimentComparison` 是内建首页使用的 report-only 组合组件，只把 `ScopeSummary`、一张成本 × 主读数散点和 `ExperimentList` 摆在一起，不发明自己的 data 形状或渲染面。

各组件的专属 props 与用法在各自的文件里：[`ExperimentComparison`](experiment-comparison.md)、[`ScopeSummary`](scope-summary.md)。

## 相关阅读

- [组件树](../README.md) —— 组合组件为什么不收结构子节点。
- [实体列表](../entity-lists/README.md) —— 从汇总下钻到 experiment / eval / attempt。
- [图表](../charts/README.md) —— 散点与其它图形投影。
- [内建报告](../../library/built-in.md) —— 裸宿主装载的默认定义。
