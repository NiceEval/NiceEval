# Verdict

Verdict 是 Attempt-owned `RecordAttachment` 中的终态业务数据。Attachment 名称是 `niceeval.verdict`，首个精确 payload schema 是 `niceeval.verdict/v1`；它的值只有 `passed`、`failed`、`errored` 和 `skipped`。

Verdict 从 execution outcome 和已封口的 `AssertionResult` projection 离线折叠。它不重新运行 Match、
不根据最后一个 Turn 推断，也不为 Judge 建立例外。

通过制与计分制的每个 Attempt 都写入这个四态 Verdict。Score Eval 的 Attempt 另有独立 `niceeval.score/v1` Attachment；Verdict 与 score 并存，互不推导。Assertions 的 `points` 只是 Score Eval 内的挣分，不是 `evaluationKind`。

`niceeval.verdict/v1` 是独立于 Record Core 的事实 schema。未来相邻版本必须提供精确 migration，或声明 `not-losslessly-migratable`；普通读取不自动迁移。是否复用由具名 reuse planning 的 schema/domain accept set 决定。

## 从哪里开始

- [Architecture](architecture.md)：Severity、四态折叠、Attachment 数据和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 与 eligibility。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
