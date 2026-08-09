# `AttemptDetails`

`AttemptDetails` 显示 executor 已经交付的一份 Attempt details data：

```tsx
<AttemptDetails attempt={attempt} />
```

它不读取 Record，不接受惰性数据源，也不建立旁路内容槽。
details data 由参数化 page 在 plan 中声明所需 Projector 后生成。

## 输入

```ts
interface AttemptDetailsSection {
  readonly id: string;
  readonly value: EvidenceValue<ReportJsonValue>;
}

interface AttemptDetailsData {
  readonly attempt: AttemptRef;
  readonly membership: SampleMembership;
  readonly sections: readonly AttemptDetailsSection[];
}

interface AttemptDetailsProps {
  readonly attempt: AttemptDetailsData;
  readonly locale?: ReportLocale;
  readonly className?: string;
}
```

`AttemptDetailsSection`、`AttemptDetailsData` 与 `AttemptDetailsProps` 只在本页定义。`AttemptRef` 与 `EvidenceValue` 由 [Record Library](../../../record/library.md#runcontribution-与-attempt-handle) owner；`SampleMembership` 由 [Sample Library](../../../sample/library.md#成员address-与-member-identity) owner；`ReportJsonValue` 与 `ReportLocale` 由 [Reports Library](../../library.md#通用值文本与参数) owner。

`AttemptDetailsData` 包含完整 AttemptRef、membership provenance、已建立的 EvidenceValue 与组件所需的纯投影。
每个 Projection 都保留 basedOn；不可用 evidence 保留全部 causes，不以空字段代替。

## 默认内容

默认详情按稳定顺序呈现：

1. Attempt identity、origin Run、当前 membership slot 与 adopted revision。
2. verdict、usage、耗时、成本、得分与其它 available facts。
3. unavailable evidence 的完整 causes / basedOn，或 available limited evidence 的 verification / issues。
4. 已计划的源码、执行、时间、对话、trace 与文件差异投影。
5. 与同一 ReportPlan 中已有 instance 对应的下钻 target。

组件不能在「读者展开一个区块」时才读取新的 evidence。
缺失的区块显示其 EvidenceValue 的原样状态；源 Record 中已有而导出失败的证据不会被显示成 `not-recorded`。

## 自定义详情

Attempt 详情 instance 由 plan 从固定 Sample membership 枚举：

```tsx
const pages = attemptDetailPages(sample, {
  projector: attemptDetails,
  render({ attempt }) {
    return <AttemptDetails attempt={attempt} />;
  },
});
```

`attemptDetailPages()` 返回显式 instanceId 与 route 的 `ReportPageInput`；它不使用普通 singleton
page 的省略 shorthand。instanceId 由完整 Sample member identity 确定，route 只编码已枚举 target。

要改顺序或删区块，修改该 instance 的 render。
不能新增由 URL 驱动的数据阶段、按 URL 打开未经计划的 Attempt，或在 renderer 调用 Projector。

## 两面

text 面按终端任务顺序输出已交付区块；web 面用同一份树输出语义 DOM，并可把已有 target 渐进增强为 dialog。
dialog 只换摆放位置，不建立第二份内容或数据读取路径。

## 相关阅读

- [Attempt diff](attempt-diff.md) —— Diff Projection 的值形状和可用性。
- [Library · 参数化页](../../library.md#参数化页attempt-与-experiment-详情)
- [Architecture · 多页、目标与参数化页面](../../architecture.md#多页目标与参数化页面)
- [show](../../show.md)
