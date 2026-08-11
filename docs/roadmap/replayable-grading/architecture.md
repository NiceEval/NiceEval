# 可重评分 Eval —— 架构

完整 Assertion 语义在 [Assertions](../../feature/assertions/README.md)。Replayable grading 只改变
subject 的读取位置：新的 Assertion 从 sealed Observation/ref graph 读取，而不是读取可变的运行期对象。

## 两层边界

| 层 | 写入物 | 不可变性 |
|---|---|---|
| execution | Observation、引用清单、可信终态与 execution outcome | seal 后不能修改 |
| grading | 明确版本的定义、AssertionResult 与 projection | 每次运行形成新 claim |

GradingDefinition 声明它需要的 Observation 与 ref。缺失的 sealed 输入产生 `unavailable` 或 `errored`，
不猜测旧值，也不回到被测 Agent、Sandbox 或网络重新取证。

## projection

Pass grading 使用 Boolean condition 与 thresholded measurement 折叠 Verdict。Score grading 累加显式
score contribution。Record-only Assertion 的问题只保留 Issue；参与 score 的 Assertion 或 control Assertion
不可用时，grading 保存 `partialScore` 并不可排名。

每个 claim 在 `subjectSnapshotRef` 指向具体 sealed graph 节点。它不能借用“当时最后一个 Turn”或把旧
AssertionResult 反序列化为任意原始 JavaScript value。

## identity 与读取

claim identity 包含 GradingDefinition 的版本、evaluator identity / version、安全 config digest 与输入 ref。
`show`、`view`、JSON 和 export 从该 claim 离线投影结果；它们不重新运行 evaluator。
