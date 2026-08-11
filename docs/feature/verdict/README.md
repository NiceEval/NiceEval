# Verdict

Verdict 是 Pass Eval 的 Attempt 终态：`passed`、`failed`、`errored` 或 `skipped`。Score Eval 没有
Verdict；它只产生累计 score 与可排名性。

Verdict 从 execution outcome 和已封口的 `AssertionResult` projection 离线折叠。它不重新运行 Match、
不根据最后一个 Turn 推断，也不为 Judge 建立例外。

通过制与计分制的 origin Attempt 都写入这个四态 Verdict。Score Eval 的 Attempt 另有独立 score Channel；Verdict 与 score 并存，互不推导。

`niceeval.verdict/v1` 与 `niceeval.eligibility/v1` 是 project-target policy v1 所需的永久事实 schema。两者的 decoder 在 `niceeval.record/v1` 生命周期内永久支持，`/v1` payload 永不扩展；是否复用由具名 reuse planning 的 schema/domain accept set 决定。

## 从哪里开始

- [Architecture](architecture.md)：Severity、四态折叠、channel 数据和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 与 eligibility。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
