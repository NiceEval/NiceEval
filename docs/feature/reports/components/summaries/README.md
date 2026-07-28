# Sample 页区块

这一组是默认报告 Sample 页的组合组件，各自回答一个固定问题：

| 组合组件 | 回答什么 |
|---|---|
| [`SampleOverview`](sample-overview.md) | 这份 Sample 整体怎样（内建首页的完整装配） |
| [`SampleSummary`](sample-summary.md) | 有多大、判定构成怎样、主读数与成本在哪个水位 |
| [`SampleNotices`](sample-notices.md) | 这份 Sample 的数字可不可信 |
| [`RunNotices`](run-notices.md) | 这批 Run 的执行过程有没有问题 |
| [`SampleFixPrompt`](sample-fix-prompt.md) | 拿什么去修这批失败 |
| [`FailureList`](failure-list.md) | 现在有哪些失败要处理 |

它们都是用公开数据源与原语写成的普通组合组件，没有宿主特权；每篇给出等价全文，照抄即可改。
attempt-input page 的对应区块族在 [Attempt 详情](../attempt-detail/README.md)。

## 相关阅读

- [组件树](../README.md) —— 组合组件为什么不收结构子节点。
- [实体数据源](../sources/entity.md) —— 从汇总下钻到 experiment / eval / attempt。
- [图表](../charts/README.md) —— 散点与其它图形投影。
- [内建报告](../../library/built-in.md) —— 裸宿主装载的默认定义。
