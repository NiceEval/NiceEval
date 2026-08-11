# 局部执行之后投影完整分析分母

## 解决的问题

project-target execution projector 可以把部分目标 slot 判为 reuse，把其余 slot 判为 gap。planner 只执行 gap；局部执行是这次投影的结果，不是 Record 或 AnalysisSample 的能力。

运行结束后，Reports 仍需要知道已落盘 Run 的完整分母，以及每个 slot 是本次执行、当时采用已有 Attempt，还是没有结果。

## 场景

Experiment `baseline` 有 Eval `a` 与 `b`：

| Run | `a` slot | `b` slot |
|---|---|---|
| `R1` | `executed(A1)` | `executed(B1)` |
| `R2` | `executed(A2)` | `carried(B1)` |
| `R3` | `executed(A3)` | `accepted(B1)` |

`B1` 的执行事实只保存一次。`R2` 与 `R3` 的 Member 采用同一个 Attempt，分别说明当时自动沿用与人工明确采用。这些 Member 不持续证明 `B1` 对未来 Project Target 仍可复用。

## 选择流程

```ts
const sample = await projectExplicitRuns(record, {
  runIds: ["R3"],
});
```

1. `explicit-runs/v1` analysis projector 读取 `R3.run.json` 的 expected membership。
2. `a` slot 的 executed Member 读出 `A3`。
3. `b` slot 的 accepted Member 读出 `B1`，同时保留 `memberKind: "accepted"` 与 `originRunId`。
4. expected slot 没有 Member 时，`AnalysisSample` 仍保留该分母项并标为 `not-recorded`。

已经创建的内存 `AnalysisSample` 不会自动变化。重新打开 reader 会重新冻结 candidateSet，但已发布 `B1` 的 bytes 不由 NiceEval 修改。

源 Attempt 因外部损坏而缺失、引用身份不匹配或出现重复身份时，`b` slot 是 `invalid`。它不会回扫其它 Run 寻找替代 Attempt，也不会被解释成 `not-recorded`。

## 边界

- Attempt 的 origin 不因 carried 或 accepted 改变。
- 每个 expected slot 最多有一个正式 Member。
- analysis projector 不根据目录名推断 membership。
- reader 只分析完整发布的 Run；运行中 draft 不属于 Record。
- 是否再次执行任何 slot 由新的 `ExecutionProjection` 决定，不从这份 `AnalysisSample` 推导。
