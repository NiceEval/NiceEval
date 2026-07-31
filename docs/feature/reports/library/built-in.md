# 内建报告

内建报告是只使用公开函数、组件与 PageDefinition 装配的普通 ReportDefinition。
它没有私有计算协议、隐藏过滤或宿主专用组件。

## `standard`

`standard` 静态导出以下页面：

1. 报告首页：摘要、质量—成本散点与 Experiment 列表。
2. Attempts：当前 Sample 的 Attempt 列表。
3. Traces：当前 Sample 的执行时间树。
4. Attempt：按 locator 参数化、`navigation: false` 的详情页。
5. Experiment：按 experiment id 参数化、`navigation: false` 的详情页。

首页先用公开任务函数计算结果，再把同一份值交给图和表。
质量—成本前沿是首页旁的普通数组算法，不是公共数据源或 Calculation。
题型与主读数的选择也由首页任务函数显式完成。

## 公开复用单位

官方导出完整 `standard`，也导出它使用的具名任务函数与 page：

```ts
standard;
standardOverviewPage;
standardAttemptsPage;
standardTracesPage;
standardAttemptPage;
standardExperimentPage;
```

作者可以把官方 page 放进自己的静态 `pages` 数组：

```tsx
export default defineReport({
  title: "Team report",
  pages: [
    {
      id: "team",
      title: "Team",
      render: teamOverview,
    },
    standardAttemptPage,
  ],
});
```

报告不提供继承或 override 协议。
要改变一张官方 page，复制其公开全文后修改；要原样复用，就直接引用具名 PageDefinition。

## failures 与 stability

`failures` 与 `stability` 也是完整内建报告。
它们的领域算法是与报告同目录的普通函数，并通过 `metricValue()` / `evidenceRow()` 交出带证据结果。

这些算法可以具名导出并被用户报告调用，但不因此进入公共计算内核。
只有满足 [计算准入判据](../calculations.md#计算的准入判据)时，才提升为 `niceeval/report` 的公共工具。

## show 共用任务结果

内建 show 切片各有一个公开任务函数。
一次调用只执行一次，然后由 text 组件与 ShowJson 序列化分别消费：

```text
comparisonResult(sample)
  ├─ text → ComparisonTable(result)
  └─ json → ShowJson { view: "compare", data: result }
```

内建 page 调用同一个任务函数。
CLI 注册表只负责 flag 分派，不另存一套计算公式。

## 主题

内建 `basalt` 与 `chalk` 主题只改变外观，不改变 page、任务函数或结果值。
完整装载链见 [主题](theme.md)。

## 相关阅读

- [Library](../library.md) —— 普通值作者 API。
- [Calculations](../calculations.md) —— 内核与报告旁算法的边界。
- [默认报告](../show/default-report.md) —— show / view 的默认选择。
