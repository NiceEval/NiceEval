# 概览

回答「这批结果有多大、整体是否健康、当前水位在哪」的两个层次:`sampleSummary()` 把 Sample 算成
`Grid` Content;`SampleOverview` 是内建首页的组合组件,装配摘要、成本 × 主读数散点与
`experimentRows`。

完整契约见 [`SampleOverview`](sample-overview.md) 与 [`sampleSummary`](sample-summary.md)。

## 相关阅读

- [组件树](../README.md) —— 组合组件为什么不收结构子节点。
- [实体列表](../entity-lists/README.md) —— 从汇总下钻到 experiment / eval / attempt。
- [图表](../charts/README.md) —— 散点与其它图形投影。
- [内建报告](../../library/built-in.md) —— 裸宿主装载的默认定义。
