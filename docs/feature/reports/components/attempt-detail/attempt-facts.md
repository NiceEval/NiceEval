# Attempt facts

Attempt facts 是一个由 `defineAttemptProjector()` 构造的投影，不是详情组件对 Record 字段的直接访问。它通过 `ProjectionReadContext` 读取与完整 `AttemptRef` 绑定的 snapshot fact，并把读取链交给 executor 形成 `basedOn`。

```ts
interface AttemptFactsData {
  readonly facts: EvidenceValue<readonly FactCell[]>;
}

interface FactCell {
  readonly key: string;
  readonly value: string | number | boolean;
}
```

`AttemptFactsData` 与 `FactCell` 的唯一 owner 是本页；`EvidenceValue` 由 [Record Library](../../../record/library.md#evidencevaluevalue-与-verification-两轴) owner。

Projector 参数、完整 Graph、attemptId 与 adopted NodeRef 都进入 identity。事实 schema 属于 Record 的写入方；Reports 只消费 Projector 已交付的值，不按 key 名、event 名或 UI 字段反推其它事实。

facts 是开放键集合，因此详情在 `available` 时显示完整键值表与 verification，而不是压成一行摘要。
`unavailable` 时组件显示全部 causes 与 basedOn，不合成 verification；它不以空对象、零值或自行挑出的主因替代该状态。

text 与 web 对同一份 `AttemptFactsData` 使用相同顺序。若无可显示项，Plan 中的详情 data 已明确该分支，组件只输出零内容，不会趁展开时读取新的证据。

其它作用域的事实必须有独立的 Projector、Calculation 和数据入口；Attempt 详情不会把它们混入当前 Attempt 的 facts 表。

## 相关阅读

- [Attempt 详情](README.md) —— 已计划详情数据的容器。
- [Reports Library](../../library.md#分组函数与计算函数) —— Projector、Calculation 与 EvidenceValue。
- [Record](../../../record/README.md) —— snapshot 事实的写入契约。
