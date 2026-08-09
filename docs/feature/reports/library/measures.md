# 计算函数、分组与读数值

Reports 的公共计算面由 Projector、Calculation、Reducer、`rollup()`、`aggregate()`、`metricValue()` 与 `evidenceRow()` 组成。
完整定义见 [Library](../library.md#分组函数与计算函数)。`CalculationInput`、`ProjectorRequest`、`MetricCoverage`、`MetricValue` 与 `CoverageMember` 都只在该链接的 Reports Library 小节定义。

## Calculation

Calculation 静态列出 Projector dependency，并以纯函数计算其已交付输入：

```ts
const workspaceDiffRequest = projectorRequest({
  requestId: "workspace-diff",
  projector: workspaceDiff,
  input: { includeGenerated: false },
});

const changedLines = defineCalculation({
  namespace: "acme.checkout",
  name: "changed-lines",
  version: "1",
  requests: [workspaceDiffRequest],
  evaluate(input) {
    return mapEvidence(input.get(workspaceDiffRequest), (diff) =>
      countChangedLines(diff, input.member.attempt),
    );
  },
});
```

`mapEvidence()` 保留 basedOn、verification、causes 与 issues。
Calculation 不能读 Record、网络或任意 Store，也不能用 `null` 抹去 unavailable。
每个 Calculation 还有写入 plan identity 的 canonical JSON `configuration`：普通
`defineCalculation()` 是 `{}`，`rollup()` / `aggregate()` 保存其规范化构造参数。

## 分组函数

`aggregate().by` 的 `eval` / `mode` 只读取固定 Sample membership 的 Contribution；`agent` /
`experiment` 则声明内建 Record Projector dependency：

```ts
const performance = aggregate(sample, {
  id: "performance",
  by: ["experiment", "agent"],
  measures: { passRate, costUSD },
  unavailable: "exclude",
});
```

agent Projector 读取与 Contribution / Attempt 绑定的 agent provenance。
experiment Projector 读取认证的 Run / Contribution experiment evidence。

executor 把完整 contribution node、runId、contributionId、revision 与 membershipSlot 作为规范化
Projector input。因此 request、memo identity 与 ReportExportPlan 都能审计。

Projector unavailable 的成员进入
`AggregateResult.coverage.unavailable`，不产生 `unknown` group 或从 Sample 字段猜值。

自定义 group 接收一个 membership 的冻结 provenance 视图，必须同步返回稳定标量。
它不接收 raw event、Projection value 或 renderer context。

## MetricValue

每个聚合读数保留 available 或 unavailable 的完整 EvidenceValue 语义：

`MetricCoverage` 与 `MetricValue` 的完整 discriminated union 在 [Reports Library](../library.md#分组函数与计算函数)。
零 included 成员一定生成 state 为 unavailable 的 `MetricValue`。
available 结果的 verification 使用所有纳入 evidence 的最差等级，并合并全部 issues。
unavailable 结果保存非空 causes、coverage、basedOn 与 refs，不含也不合成 verification；这与
Record-owned `EvidenceValue` 的 unavailable 分支一致。

`aggregate()` 的 request output 是 `AggregateResult { rows, coverage }`；放进 ReportData 后是完整
`AggregateData = EvidenceValue<AggregateResult>`。顶层 coverage 负责 Sample 与 group assignment，
每个 MetricValue.coverage 负责该 group 内 measure reducer。Table / charts 原样接 AggregateData；
artifact 也持久化相同 discriminated JSON，不存在未包装 rows / null / 空数组的替代形状。

## 官方 Calculation

官方入口提供 `passRate`、`costUSD`、`durationMs`、`tokens` 与 `totalScore` 等 Calculation。
它们与用户定义的 Calculation 通过同一个 executor、memo 和 EvidenceValue 规则运行。

成本、耗时、usage、verdict 和 score 都来自对应 Projector。
没有被 snapshot 进 Record 的事实只能产生 unavailable，不由报告补猜。

## 题型构成与主读数

题型、模型、flags 与 labels 都必须来自固定 membership provenance 或明示的 Projector；Agent 使用
上述内建 group Projector，不能从 Sample 不拥有的字段或 id 字符串反推。
首页、摘要和图表可以基于已计划的 composition 选择显示哪些 metrics；这种分支不允许添加新数据请求。

混合题型显示各自可比较的 MetricValue，不把没有共同单位的数值压成一个分数。

## 维度与数值轴

维度声明映射到 ReportPlan 中已有 group key 或 snapshot provenance。
数值轴只能消费已有 MetricValue 或带 basedOn 的外部 snapshot Projection。

字段不存在、类型不匹配或不在固定 Sample 内时，executor 产生有依据的 unavailable 值。
图表只显示该值，不从显示字段回推 Record 结构。

## 相关阅读

- [Calculations](../calculations.md) —— 两级聚合与报告旁算法。
- [Library](../library.md) —— `aggregate()`、MetricValue 与结果行。
- [格式化](presentation.md) —— locale、verification 与 unavailable 的显示。
