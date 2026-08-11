# Assertions —— display

读取语义以 [Assertions](../README.md) 与 [Architecture](../architecture.md) 为准。本页规定同一 projection
在用户界面的名称与最小信息。

## Pass Eval

Pass 的 Attempt 区块顺序为 Execution、Verdict、检查项。每条检查项显示 label 或 key、evaluation、
evidence、必要的 threshold 与 Issue。

measurement 只作诊断显示：`0.73, required >= 0.8, mismatched`。它不是 score，Pass 页面不显示
累计 score、百分比或贡献项。

## Score Eval

Score 的 Attempt 区块顺序为 Execution、Score、评分项。每条评分项显示 `recorded`、实际贡献，例如
`+2` 或 `+4`，以及 threshold condition 或 stop cause。

Score 页面不显示 Verdict、Pass / Fail、总分、max、百分比、points 或 weight。未配置 `.score()` 的
Assertion 显示 `recorded`，不显示 `+0`。没有 contribution 时，正式 score 为 `0`，并提示
“没有贡献分数的评分项”。

不可排名的 Score grading 显示 `partial score not ranked`、partial score 与 Issue。正常 `.orStop()`
显示 stop cause，但仍显示可排名的正式 score。

## 同一投影

`show`、`view`、JSON、export 与 source 都离线读取同一 `AssertionResult` projection。一个界面不能重跑
Match、重新读取 evidence 或调用 Judge 来补另一套解释。
