# Experiment 详情

`ExperimentDetails` 显示一份计划好的 `ExperimentDetailsData`：

```tsx
<ExperimentDetails input={input} />
```

页面在 plan 中从固定 Sample 枚举 experiment instance，并声明该 instance 的 data dependency。
组件不从隐式上下文取 Sample，也不在 render 时收窄或打开 Store。

## 输入

```ts
interface ExperimentDetailsIdentity {
  readonly experimentId: string;
  readonly agent: string;
  readonly model?: string;
  readonly flags: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
}

interface ExperimentDetailsData {
  readonly identity: ExperimentDetailsIdentity;
  readonly members: readonly SampleMembership[];
  readonly metrics: readonly MetricValue[];
  readonly coverage: MetricCoverage;
  readonly verdict: EvidenceValue<ReportJsonValue>;
  readonly notices: readonly EvidenceValue<ReportJsonValue>[];
}

interface ExperimentDetailsProps {
  readonly input: ExperimentDetailsData;
  readonly locale?: ReportLocale;
  readonly className?: string;
}
```

`ExperimentDetailsIdentity`、`ExperimentDetailsData` 与 `ExperimentDetailsProps` 的唯一 owner 是本页。
`SampleMembership` 由 [Sample Library](../../../sample/library.md#成员address-与-member-identity) owner。
`MetricValue` 与 `MetricCoverage` 由 [Reports Library](../../library.md#分组函数与计算函数) owner。
`ReportJsonValue` 与 `ReportLocale` 由 [Reports Library](../../library.md#通用值文本与参数) owner。
`EvidenceValue` 由 [Record Library](../../../record/library.md#evidencevaluevalue-与-verification-两轴) owner。

## 区块

| 区块 | 内容 |
|---|---|
| 实验身份 | 已交付 provenance 中的 experiment、agent、model、flags 与 labels |
| 读数摘要 | MetricValue、coverage 与 refs；available verification / issues 或 unavailable causes |
| 结果构成 | 已计划的 verdict Projection |
| 题目清单 | Eval → Attempt 的固定 membership 层级 |
| 缺口 | excluded 与 unavailable 成员及其完整原因 |
| notices | 已交付的 diagnostics Projection |

## 两面

text 面与 web 面消费同一份 ExperimentDetailsData。
locator 或 refs 只指向同一 ReportPlan 中存在的 Attempt instance；不能服务的 target 以文本和明确反馈显示。

## 相关阅读

- [Library · 参数化页](../../library.md#参数化页attempt-与-experiment-详情)
- [Experiment scatter](../summaries/experiment-scatter.md) —— 默认散点的 target。
- [Attempt details](../attempt-detail/README.md) —— 题目清单的目的地。
