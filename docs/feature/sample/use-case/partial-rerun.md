# 局部执行之后选择完整分析分母

## 解决的问题

reuse planning 可以把部分目标 slot 判为 reuse，把其余 slot 判为 gap。planner 只执行 gap；局部执行是这次规划的结果，不是 Record 或 AnalysisSample 的能力。

运行结束后，Reports 仍需要知道已落盘 Run 的完整分母，以及每个 slot 是本次执行、当时采用已有 Attempt，还是没有结果。

## 场景

Experiment `baseline` 有 Eval `a` 与 `b`：

| Run | `a` slot | `b` slot | actions provenance |
|---|---|---|---|
| `R1` | `origin(A1)` | `origin(B1)` | executed / executed |
| `R2` | `origin(A2)` | `reference(B1)` | executed / carried |
| `R3` | `origin(A3)` | `reference(B1)` | executed / accepted |

`B1` 的执行事实只保存一次。`R2` 与 `R3` 的 Member 都只表达“这个 slot 由 B1 完整占据”；当时是自动沿用还是人工明确采用，由各 Run 的 `niceeval.membership-provenance` Attachment 说明。这些 Member 和 actions 都不持续证明 `B1` 对未来 Project Target 仍可复用。

## 选择流程

```ts
import { Effect } from "effect";

declare const reader: RecordReader;
declare const runId: RunId;

const program = Effect.gen(function* () {
  const selection = yield* selectExplicitRuns(reader, {
    runIds: [runId],
  });

  return selection.sample;
});
```

1. `explicit-runs` selection 读取 `R3` 的 Run Core 与 expected membership。
2. `a` slot 的 Member 读出 `A3`，因当前 slot 等于 Attempt.origin 而派生 `relation: "origin"`。
3. `b` slot 的 Member 读出 `B1`，因 origin 位于 `R1` 而派生 `relation: "reference"`；若 Report 需要“accepted”，再显式请求 `R3` 的 membership provenance Attachment。
4. expected slot 没有 Member 时，`AnalysisSample` 仍保留该分母项并标为 `not-recorded`。

已经创建的内存 `AnalysisSample` 不会自动变化。重新打开 reader 会重新冻结 candidateSet，但已发布 `B1` 的 bytes 不由 NiceEval 修改。

源 Attempt 因外部损坏而缺失、引用身份不匹配或出现重复身份时，`b` slot 是 `core-invalid`。它不会回扫其它 Run 寻找替代 Attempt，也不会被解释成 `not-recorded`。

## 边界

- Attempt 的 origin 不因任何 reuse/adoption action 改变。
- 每个 expected slot 最多有一个正式 Member。
- analysis selection 不根据目录名推断 membership。
- reader 只分析完整发布的 Run；运行中 draft 不属于 Record。
- 需要继续读取 RecordAttachment 时传递 `selection`；`.sample` 是关闭 reader 后仍可显示的纯值，不会伪装成 reader capability。
- 是否再次执行任何 slot 由新的 `ExecutionReusePlan` 决定，不从这份 `AnalysisSample` 推导。
