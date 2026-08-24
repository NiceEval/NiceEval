---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 选择与收窄一个分析范围

契约单源始终在 [Analysis Library](../library.md)。本页说明已封口 Run 怎样形成固定 Sample，
以及为什么收窄和显示过滤不能混为一谈。

## 局部执行之后选择完整分析分母

reuse planning 可以把一部分目标 Slot 判为 reuse，另一部分判为 gap。planner 只执行 gap；Analysis
随后解释新 Run 已经写入持久事实的完整 expected Slot，不从 gap 反推下次该执行什么。

Experiment `baseline` 有 Eval `a` 与 `b`：

| Run | `a` slot | `b` slot | membership provenance |
|---|---|---|---|
| `R1` | `origin(A1)` | `origin(B1)` | executed / executed |
| `R2` | `origin(A2)` | `reference(B1)` | executed / carried |
| `R3` | `origin(A3)` | `reference(B1)` | executed / accepted |

`B1` 的执行事实只保存一次。`R2` 与 `R3` 的 Member 表示该 Slot 完整由 `B1` 占据；自动沿用或人工
采用是 Run 的 provenance 事实，不能持续证明 `B1` 对未来目标仍可复用。

Host 以 locator 或 CLI 的 `--run` 形成 `explicit-runs` 选择。它冻结 `R3` 的 Run Core 与 expected
membership：`a` 成为 `included` 的 origin，`b` 成为 `included` 的 reference。没有 Member 的
expected Slot 是 `not-recorded`；源 Attempt 缺失、引用身份不匹配或重复身份时是 `core-invalid`。
Analysis 不回扫另一个 Run 寻找替代 Attempt。

`project-current` 形成另一种 Selection。CLI 把当前目标的 experiment/eval/Slot execution identity
digest 交给 Analysis，后者只保留仍与这些 digest 匹配的 Slot。不匹配的 Slot 成为
`excluded` / `identity-mismatch`。它们仍留在 coverage 里，但不再进入 selected 分母。

两种选择都只读 sealed Run。已经签发的 Sample 不会因新 Run 封口或当前项目变化而改写。显式
`--run` 不走这道当前 identity 收窄。

## coverage 与收窄

Snapshot 为每个 expected Slot 保留一项状态。一个报告若只需要 `security/` 范围，必须先把这个范围
变成新的 Analysis Sample，而不是在组件中删除成员后假装分母更小。

```ts
import { narrowSample, type Sample, type SlotId } from "niceeval/analysis";

declare const sample: Sample;
declare const securitySlotIds: readonly SlotId[];

const securitySample = narrowSample(sample, {
  slotIds: securitySlotIds,
});
```

匹配项保持 `included`、`not-recorded` 或 `core-invalid`。未匹配项变成 `excluded`，并在 `base` 中保留
收窄前状态。`coverage` 因而同时说明原始 frame 与当前 selected 成员，MetricValue 的分母仍由
Measure 在这个收窄后的 Population 上确定。

selector 单字段内是 OR，多个字段间是 AND。空 selector 是错误；重复收窄不会重新纳入 excluded 成员。
收窄不读取 Record，不检查最新 Attempt，也不接受任意 predicate。需要看到新的历史事实时，Host 必须
建立新的 Selection 和 Sample。

## Snapshot、locator 与 Scope

`SampleSnapshot` 可以在 Scope 外保留，或传到 JSON 边界：

```ts
const encoded = encodeSampleSnapshot(sample.snapshot);
const snapshot = decodeSampleSnapshot(encoded);

auditSelection(snapshot.selection, snapshot.coverage);
```

解码后的 `snapshot` 不是 Sample。它只能审计固定 selection、coverage、Slot 状态与 locator；不能调用
`aggregate()`、`query()` 或读取 Attachment。locator 同样只是精确身份，不是 reader capability。

当 Host 关闭 Sample 所属 Scope 时，后续 `narrowSample(sample, selector)`、`aggregate(sample, request)`
与 `query(sample, request)` 都以 `analysis-sample-closed` 失败，并且不会开始新的 I/O。已经创建的
Snapshot、ClosedRows、SemanticFrame 和 DomainView 仍是可安全呈现的闭合值。
