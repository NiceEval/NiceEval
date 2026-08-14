# Verdict

Verdict 是 Attempt-owned `RecordAttachment` 中的终态业务数据。当前精确 payload schema 是 `niceeval.verdict/v2`；payload 仍可表达 `passed`、`failed`、`errored` 和 `skipped`，但题型约束其合法子集。

Verdict 从 execution outcome 和已封口的 `AssertionResult` projection 离线折叠。它不重新运行 Match、
不根据最后一个 Turn 推断，也不为 Judge 建立例外。

Pass Eval 使用四态 Verdict。Score Eval 只允许 `passed | errored`，并另写独立 `niceeval.score/v1` Attachment；正常低分或零分仍是 passed。Assertions 的 `points` 只是 Score Eval 内的挣分，不是 `evaluationKind`。

`niceeval.verdict/v1 → v2` 因 Score gate 语义消失而不可无损迁移。Record Core 不变；历史 v1 保留原义，新行为与 reuse 只接受 v2，并以新的 evaluation algorithm 与 reuse identity 隔离。

## 从哪里开始

- [Architecture](architecture.md)：Severity、四态折叠、Attachment 数据和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 与 eligibility。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
