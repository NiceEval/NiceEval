# Experiment table

`ExperimentTable` 显示 plan 已交付的实验层级数据：

```tsx
<ExperimentTable rows={rows} />
```

`rows` 是按 experiment 分组的完整 `AggregateData`。组件先判别外层 EvidenceValue；available 时
消费 `value.rows` 与顶层 `value.coverage`，unavailable 时显示完整 causes / basedOn，不以 `[]`
伪装成“没有实验”。

页面在 plan 中声明 Experiment summary Projector 与 MetricValue request，再把结果作为 `rows` 交给组件：

```text
Experiment
└── Eval
    └── Attempt
```

组件不重新选择 Sample membership，也不读取 Run、raw event 或 renderer context。

## 成员与 provenance

每个 Attempt 行显示完整 AttemptRef 和该固定 Sample membership 的 provenance。
`executed`、`carried`、`accepted` 与 `renamed` 都是明确的 contribution mode，不产生第二套计票规则。

Experiment、Eval 与 Attempt 行各自显示已建立的 MetricValue、coverage、下钻 refs，以及 available 分支的 verification；unavailable 分支显示 causes 与 basedOn。
组件不会从 locator、字段名或时间推断 origin Run、adopted revision 或证据资格。

## 缺口与动作

coverage 中的 excluded 与 unavailable 成员保留为明确占位行。
每行显示 Sample 已确定的原因和 membership 或 EvidenceRef；表格不挑一个主因，也不把原因改写为零值。

需要重跑、接受或重新选择范围的动作由上层 host 根据已交付 provenance 提供。
ExperimentTable 不假设某个动作一定可行，也不在 UI 中修改 Record。

## 报告没有口径开关

排序、搜索与折叠只改变已生成行的摆放或可见性。
它们不能改变 Sample 成员、coverage、Calculation policy 或 ReportPlan。
