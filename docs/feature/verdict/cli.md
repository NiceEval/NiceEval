# Verdict —— CLI 预期反馈

CLI 没有改变 Assertion policy 的全局开关。Pass Eval 显示 Execution、Verdict 和检查项；Score Eval 显示
Execution、Verdict、Score 和评分项。

Pass 的 `failed` 指向 mismatched condition，`errored` 指向 execution 或 evaluator 问题，`skipped` 显示
显式 skip 原因。measurement 显示实际值和 required threshold，不显示为 score。

Score 显示 earned score、`complete` / `partial` / `unavailable`、每项 `recorded` 或 `+n`、局部 condition
和 stop cause。它显示四态 Verdict，但不把 score 重命名成 Pass / Fail，也不显示 max 或百分比。partial
显示已知下界与 Issue；unavailable 不伪造 `0`。

终端、`niceeval show`、网页、JSON 和 export 共享同一份 `AssertionResult` projection。
