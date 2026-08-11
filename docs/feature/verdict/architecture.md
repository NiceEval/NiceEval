# Verdict 与 AssertionResult

完整 Assertion 模型见 [Assertions](../assertions/README.md)。Verdict 只属于 Pass Eval。

## Pass fold

| 优先级 | 条件 | Verdict |
|---|---|---|
| 1 | execution error，或参与 Pass grading 的 unavailable / errored | `errored` |
| 2 | 任一 Boolean condition mismatched | `failed` |
| 3 | 显式 `t.skip(reason)`，且没有更高优先级条件 | `skipped` |
| 4 | 其余情形 | `passed` |

Boolean Assertion 默认是 Pass condition。measurement 必须先 `.atLeast(n)` 才能成为 condition。
`notApplicable` 不参与 fold。普通 mismatch 不会停止后续检查；只有被 await 的 `.orStop()` 会设置
authoring stop latch。

## Score Eval 不进入此 fold

Score Eval 累加 configured contribution。正常 mismatch 或 below 不会使 score 失效。已配置 score 的
Assertion、direct score 或 control Assertion 遇到 `unavailable` / `errored` 时，grading 不可排名并保留
`partialScore`；record-only Assertion 的 Issue 不作废正式 score。

完整 record union 见 [Assertions architecture](../assertions/architecture.md)。
