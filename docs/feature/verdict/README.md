# Verdict

Verdict 是 Pass Eval 的 Attempt 终态：`passed`、`failed`、`errored` 或 `skipped`。Score Eval 没有
Verdict；它只产生累计 score 与可排名性。

Verdict 从 execution outcome 和已封口的 `AssertionResult` projection 离线折叠。它不重新运行 Match、
不根据最后一个 Turn 推断，也不为 Judge 建立例外。

| 目的 | 入口 |
|---|---|
| 了解 Pass fold | [Architecture](architecture.md) |
| 了解 CLI 与报告投影 | [CLI](cli.md) |
| 编写 Assertion 或 Score Eval | [Assertions](../assertions/README.md) |
