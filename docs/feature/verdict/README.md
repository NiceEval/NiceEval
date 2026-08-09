# Verdict

Verdict 是 Attempt-owned <code>niceeval.verdict</code> channel 中的终态业务数据。它的值只有 <code>passed</code>、<code>failed</code>、<code>errored</code> 和 <code>skipped</code>。

它把 Assertion 结果、执行错误、strict policy 和显式 skip 归并为一个可读状态。它不替代 Attempt origin、Member 或 Run 的完成时间，也不复制 usage、diff、conversation 或诊断。

<code>niceeval.verdict</code> 是 planner-critical channel，<code>niceeval.eligibility</code> 也是。两者在 <code>niceeval.record</code> 的生命周期内永久支持，精确 payload 永不扩展。

## 从哪里开始

- [Architecture](architecture.md)：Severity、四态折叠、channel 数据和读取规则。
- [Assertions](../assertions/README.md)：断言怎样形成输入。
- [缓存与携带](../experiments/cache.md)：planner 怎样使用 Verdict 与 eligibility。
- [Reports](../reports/README.md)：页面怎样呈现状态和完整度。
