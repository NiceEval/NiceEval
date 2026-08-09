# 局部补跑之后选择完整分母

## 解决的问题

一次 Experiment 可以只重跑部分 Eval。Reports 仍需要知道完整分母，以及每个 slot 是本次执行、沿用已有 Attempt，还是没有结果。

## 场景

Experiment `baseline` 有 Eval `a` 与 `b`：

| Run | `a` slot | `b` slot |
|---|---|---|
| `R1` | `executed(A1)` | `executed(B1)` |
| `R2` | `executed(A2)` | `carried(B1)` |
| `R3` | `executed(A3)` | `accepted(B1)` |

`B1` 的执行事实只保存一次。`R2` 与 `R3` 的 Member 采用同一个 Attempt，分别说明沿用与人工接受。

## 选择流程

```ts
const sample = await selectSample(record, {
  kind: "runs",
  runIds: ["R3"],
});
```

1. `selectSample()` 读取 `R3.run.json` 的 expected membership。
2. `a` slot 的 executed Member 读出 `A3`。
3. `b` slot 的 accepted Member 读出 `B1`，同时保留 `memberKind: "accepted"` 与 `originRunId`。
4. expected slot 没有 Member 时，Sample 仍保留该分母项并标为 `not-recorded`。

如果用户在停稳目录中修改 `B1` 的 Verdict 或 Usage，再次选择 `R3` 会读取修改后的值。已经创建的内存 Sample 不会自动变化。

源 Attempt 被删除、引用身份不匹配或出现重复身份时，`b` slot 是 `invalid`。它不会回扫其它 Run 寻找替代 Attempt，也不会被解释成 `not-recorded`。

## 边界

- Attempt 的 origin 不因 carried 或 accepted 改变。
- 每个 expected slot 最多有一个正式 Member。
- Sample 不根据时间或目录名推断 membership。
- 要分析 unfinished Run，必须显式给出它的 `runId`。
