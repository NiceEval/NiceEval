# Verdict

Verdict 是 Attempt-owned `niceeval.verdict` channel 中的终态业务数据；首个精确 schema 是 `niceeval.verdict/v1`。它的值只有 `passed`、`failed`、`errored` 和 `skipped`。

它把 Assertion 结果、执行错误、strict policy 和显式 skip 归并为一个可读状态。它不替代 Attempt origin、Member 或 Run 的完成时间，也不复制 usage、diff、conversation 或诊断。

`niceeval.verdict/v1` 与 `niceeval.eligibility/v1` 是 project-target policy v1 所需的永久事实 schema。两者的 decoder 在 `niceeval.record/v1` 生命周期内永久支持，`/v1` payload 永不扩展；是否复用由具名 execution projector 的 schema/domain accept set 决定。

## 从哪里开始

- [Architecture](architecture.md)：Severity、四态折叠、channel 数据和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 与 eligibility。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
