# 对照矩阵：多个 `--exp` 的逐 Eval 比较

重复 `--exp` 选择多个固定 Sample 范围时，show 运行 comparison target。
plan 明确列出条件、baseline、Eval membership、Projector 和 paired Calculation；text、web 与 JSON 消费同一份 CompareData。

```sh
niceeval show --exp compare/baseline --exp compare/candidate
niceeval show security/ --exp compare/baseline --exp compare/candidate --json
```

每个条件必须识别为确定的 Run/Experiment selection，出现顺序决定条件顺序，首个为 baseline。
配对 identity、coverage、unavailable policy 和 delta 公式属于 Calculation，不能由矩阵 renderer 推断。

```ts
interface CompareCondition {
  readonly id: string;
  readonly sample: SampleRef;
  readonly sources: SampleSources;
  readonly runId: string;
  readonly experimentId: string;
}

interface CompareCell {
  readonly evalId: string;
  readonly values: readonly EvidenceValue<MetricValue>[];
  readonly delta: EvidenceValue<number>;
  readonly coverage: MetricCoverage;
}

interface CompareData {
  readonly baseline: CompareCondition;
  readonly conditions: readonly [CompareCondition, ...CompareCondition[]];
  readonly cells: readonly CompareCell[];
}
```

`CompareCondition`、`CompareCell` 与 `CompareData` 的唯一 owner 是本页。
`SampleRef` 与 `SampleSources` 由 [Sample Library](../../sample/library.md#选择器source-集合与-sampleref) owner。
`MetricValue` 与 `MetricCoverage` 由 [Reports Library](../library.md#分组函数与计算函数) owner；`EvidenceValue` 由 [Record Library](../../record/library.md#evidencevaluevalue-与-verification-两轴) owner。

某一侧 unavailable 时，该格保留完整 EvidenceValue 和 coverage。
它不会被旧 revision、零值或隐藏的 fallback 填充；有两侧可比较证据时才产生 delta。

## 边界

- comparison target 与显式 `--report` 互斥。
- 自定义比较报告可在自己的 Plan 中复用同一 pair Calculation，或定义明确的业务 policy。
- `@<locator>` 与多条件选择互斥，因为单个 AttemptRef 不是多条件总体。

## 相关阅读

- [Calculations](../calculations.md) —— delta 留在报告旁的原因。
- [Show](../show.md) —— 固定 Graph、范围和 target。
- [`--json`](json.md) —— 同一份结构化 CompareData。
