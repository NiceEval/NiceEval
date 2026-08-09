# 图表

图表接 page render 已经拿到的 evidence-bearing `points`。
`Scatter`、`Line`、`Bars` 与 `Area` 只声明显示形状，不读取 Sample、执行 Calculation 或打开 Store。

## 共同输入

从 Sample 派生的 aggregate 输入必须是完整 [`AggregateData`](../../library.md#分组函数与计算函数)，
也就是 `EvidenceValue<AggregateResult>`；`AggregateResult.rows` 的每一项是带 established
MetricValue 的 `EvidenceRow`。`refs` 与 `basedOn` 形状只在 Reports Library 定义；Record-owned
`AttemptRef` 与 `EvidenceRef` 也由该页链接到 Record owner。

MetricValue 自带 available/unavailable、coverage 与 refs；available 另带 verification，unavailable 另带 causes。
业务 snapshot 同样必须经 Projector 成为带 basedOn 的值；图表没有绕过证据的 external 模式。

## `Scatter`、`Line`、`Bars` 与 `Area`

```tsx
<Scatter points={performance} x="costUSD" y="passRate" point="experiment" />
<Line points={history} x="revision" y="passRate" series="agent" />
<Bars points={ranking} x="agent" y="passRate" />
```

外层 AggregateData unavailable 时，图表显示全部 causes / basedOn，不画一张空图。available 时才
读取 `points.value.rows`，并显示 `points.value.coverage` 中未能分组的成员；行内 unavailable causes
或 available verification 限制再由 MetricValue 原样显示。
`connectNulls`、limit、layout 和视觉强调只改变呈现，不生成值、不合并 coverage，也不将 unavailable 变成零。

需要不同 group、长尾桶或粒度时，在 ReportPlan 中声明另一个 aggregate request。
图表不能在交互时重算。

## 点击目标

图表原语不决定「点开去哪」。
上层只能提供 ReportPlan 中已经枚举的 `ReportTarget`；多个 refs 时组件显示明确列表，不猜一个 Attempt。
宿主无法服务 target 时，点保持纯图形并显示可解释的状态。

## 两面

- web 面输出真实 SVG / DOM、图例和已有 target 链接；无 JavaScript 时标签和数值仍可读。
- text 面用字符图或精确值表表达同一组 points；空间不足时保留系列名、终值和 EvidenceValue 状态。
- locale 切换只格式化，不重新执行 ReportPlan 或 Calculation。

## 相关阅读

- [Library · 组件接具体值](../../library.md#组件接具体值)
- [Calculations](../../calculations.md)
- [格式化与呈现](../../library/presentation.md)
