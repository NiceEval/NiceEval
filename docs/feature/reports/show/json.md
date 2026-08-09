# `--json`：内建 target 的结构化形态

`--json` 是 show 对内建 target 的结构化输出。
它与 text 面共享同一个固定 Sample sources、ReportPlan 和 ReportData；JSON 不是另一条选择、读取或聚合路径。

脚本消费应读取这个信封或 [Record](../../record/library.md) 的公开读取面，不扫描存储布局或复刻 Sample membership。

## 信封

```ts
interface ShowJson {
  format: "niceeval.show";
  schemaVersion: 2;
  sources: SampleSources;
  sample: SampleRef;
  plan: ReportPlanRef;
  target: ReportTarget;
  data: ReportJsonValue;
}
```

`data` 是内建 target 已生成的 ReportData 子树。
它可以比 text 多保留完整字符串或详情字段，但共同的 MetricValue、EvidenceValue、coverage、basedOn 与 refs 必须字节等价。

## Attempt 投影

需要提到某次 Attempt 时，JSON 使用完整引用而非持久化结果的摊平副本：

```ts
interface AttemptJson {
  attempt: AttemptRef;
  membership: SampleMembership;
  evidence: readonly EvidenceValue<ReportJsonValue>[];
}
```

`ShowJson` 与 `AttemptJson` 的唯一 owner 是本页。
`SampleSources` 与 `SampleRef` 由 [Sample Library](../../sample/library.md#选择器source-集合与-sampleref) owner。
`SampleMembership` 由 [Sample Library](../../sample/library.md#成员address-与-member-identity) owner。
`ReportPlanRef`、`ReportTarget` 与 `ReportJsonValue` 由 [Reports Library](../library.md#通用值文本与参数) owner。
`AttemptRef` 与 `EvidenceValue` 由 [Record Library](../../record/library.md#attempt-与-attemptref) owner。

`AttemptRef` 包含完整 `record`、`attemptId`、`locator` 和 adopted NodeRef。
消费者不能用 locator 字符串替代 graph 或 adopted identity。

## 边界

- JSON 不序列化任意组件树，也不从组件树反向猜数据。
- `--json` 与显式自定义 `--report` 互斥；自定义交付使用 `exportReport()`。
- 参数、范围或 target 无效时，show 非零退出且不输出半个 JSON。
- 分支原样保留：available 保留 verification / issues，unavailable 保留 causes / basedOn；JSON 不把它们折叠为 null。

## 相关阅读

- [Show](../show.md) —— 范围、target 与终端路径。
- [Library](../library.md#导出报告) —— ReportData 与 artifact 交付。
- [Sample](../../sample/library.md) —— SampleRef 和 membership proof。
