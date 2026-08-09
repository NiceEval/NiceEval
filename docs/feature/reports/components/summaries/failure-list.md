# Failure list

failures page 在 plan 中声明 failure summary Projector，并把已交付的失败 Attempt rows 交给 `AttemptList`。
排序与 limit 是页面的规范化参数或纯 display 选择，不成为组件的隐藏数值规则。

```ts
interface AttemptListProps {
  readonly attempts: readonly AttemptDetailsData[];
  readonly locale?: ReportLocale;
  readonly className?: string;
}
```

`AttemptListProps` 的唯一 owner 是本页；`AttemptDetailsData` 由 [Attempt details](../attempt-detail/README.md#输入) owner，`ReportLocale` 由 [Reports Library](../../library.md#通用值文本与参数) owner。
`AttemptList` 只接收这个 props 形状。

每行保留完整 AttemptRef、membership provenance、主失败 EvidenceValue 与可用 target；available 分支
保留 verification / issues，unavailable 分支保留 causes / basedOn。
组件不从 Sample 执行 predicate，也不在 renderer 中追加证据读取。
