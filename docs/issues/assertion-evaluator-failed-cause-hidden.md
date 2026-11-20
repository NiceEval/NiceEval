# Assertion evaluator failures hide the thrown cause in show

## 观察

断言的判定函数抛出异常时，`niceeval show @<attempt> assertions --json` 给出 `decision: { gate: "unavailable", reason: "evaluator-failed", result: "errored" }`，`show @<attempt> <ae_id> --full` 也只有 "evaluator failed"，看不到抛出的异常类型、消息或任何堆栈摘要。Attempt 总览的 Diagnostics 为 available，但不含该异常。

在核心仓库开发 `turn.sandbox` 时复现（本地源码，macOS / Node 24）：判定函数内一次无限递归让三条 diff 断言全部 errored，CLI 无法看出原因，只能在 runtime 里临时打印 `Cause.pretty(cause)` 才定位。

## 期望

`--full` 与 `--json` 给出 evaluator 失败的已脱敏原因（异常名、消息首行，受预算截断并标明），或指向记录了该原因的诊断切片；没有保存原因时明确标为 not-recorded。

## 来源

本地开发观察，通过公开 `show` 复现；未含凭据。建议标签：bug、area:cli、needs-triage。已检索本地 docs/issues，未见同一现象（相邻：show-errored-diagnostics-hidden、required-check-unavailable-diagnostic）。
