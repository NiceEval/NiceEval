# 内建报告

内建报告是只使用公开 Projector、Calculation、组件与 ReportPlan 装配的普通 ReportDefinition。
它没有私有取数协议、隐藏范围或宿主专用数据路径。

## `standard`

`standard` 的 plan 枚举概览、Attempt 列表、时间树、Attempt detail instance 与 Experiment detail instance。
每个页面的数据依赖在同一个 Plan 中声明，随后由 executor 一次性规范化与生成。

首页的质量—成本、题型构成和摘要都消费固定 Sample 的已交付 ReportData。
范围变化必须先生成新的固定 Sample，再生成新的 Plan；内建页面不能自行重选成员。

## 公开复用单位

```ts
standard;
standardOverviewPlan;
standardAttemptsPlan;
standardTracesPlan;
attemptDetailPages;
experimentDetailPages;
```

作者可以在自己的 ReportDefinition plan 中复用这些辅助 API，或用相同的公开 Projector 和 Calculation 创建替代页面。
它们不提供继承、override、隐式 load 或运行时 Store 访问。

## failures 与 stability

`failures`、`stability` 和其他领域分析仍是完整报告中的纯 Calculation/函数。
它们交出 EvidenceValue、MetricValue、coverage 与 refs，并遵守同一个 executor。
只有满足 [计算准入判据](../calculations.md#计算的准入判据)时，才进入顶层公共工具。

## show 共用结果

内建 show target 先生成 ReportPlan 和 ReportData，再由 text、web 或 JSON 形态消费。
CLI 注册表只负责 flag 到 target 的分派，不保存第二套 calculation 公式。

## 主题

内建 `basalt` 与 `chalk` 主题只改变外观，不改变 Plan、Sample、Calculation、MetricValue 或 evidence。
完整装载链见 [主题](theme.md)。

## 相关阅读

- [Library](../library.md) —— Reports 的公开 API。
- [Calculations](../calculations.md) —— 内核与报告旁算法。
- [Show](../show.md) —— 内建 target。
