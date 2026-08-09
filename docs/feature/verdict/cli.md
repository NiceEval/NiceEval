# Verdict —— CLI 预期反馈

CLI 不提供改变 Fact use 语义的全局开关。把质量线写在 eval 中：`t.assert(scoreFact, { atLeast })` 或 `await t.require(scoreFact, { atLeast })`。

## 退出与展示

- `failed` 表示某个 verdict use 未通过，或计分 Attempt 为 `invalid`。
- `errored` 表示执行、作者或 evaluator 错误，或已消费 Fact 不可用。
- `skipped` 表示显式跳过且此前没有更高优先级终态。
- `passed` 表示通过制没有失败 use，或计分 Attempt 的 score terminal 为 `scored`。

终端、`niceeval show` 与报告都显示通用 Fact/use 摘要：优先显示失败或不可用 use，其次显示对应 Fact 的结构化原因；成功的已消费 ScoreFact 显示归一化分数。它们不能把 Judge 另作断言摘要，也不能把不可用降格为空值。

Judge 缺少模型或 API key 时，消费该 Fact 的 Attempt 以 `errored` 结束，Fact use 保留机器可读原因，且没有网络请求。已配置端点的 precheck 失败在 setup 阶段直接报错；Judge 求值后的网络失败则是普通 `unavailable` Fact。

## 相关阅读

- [Verdict 与 Fact use](architecture.md) —— 折叠规则单源。
- [Judge](../judge/library.md) —— 配置、材料与 ScoreFact 用法。
