# Assertion 作者面 —— CLI

CLI 和报告从 sealed `AssertionResult` projection 读取，不再运行 evaluator。

Pass Attempt 显示 Execution、Verdict、检查项。thresholded measurement 显示实际值、required threshold 与
matched / mismatched，而不是数值成绩。

Score Attempt 显示 Execution、Score、评分项。每项显示 `recorded`、贡献分数、局部 condition 和 stop
cause。没有 `.score()` 的项绝不显示 `+0`。没有 contribution 时，显示正式 `0` 和“没有贡献分数的评分项”。

Score grading 不可排名时，显示 `partial score not ranked`、partial score 和 Issue。它不显示 Verdict、
Pass / Fail、总分、百分比、points 或 weight。
