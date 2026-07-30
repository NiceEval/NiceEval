# Judge

Judge 是由裁判模型执行的 Assertion。
它拥有模型、端点、凭据、传输重试、响应解析和 `unavailable` 原因；Assertion collector 只接收 Judge 产出的 `AssertionResult`，不理解模型协议。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 配置并调用 Judge | [Library](library.md) |
| 验证兼容网关确实完成判分 | [用例](use-case/README.md) |
| 理解 unavailable 怎样影响 Attempt | [Verdict](../verdict/architecture.md#证据不可用unavailable不折叠成通过) |

Judge 默认产生 soft Assertion；`.atLeast()`、`.gate()` 与 `.optional()` 的传播语义属于 Verdict。
