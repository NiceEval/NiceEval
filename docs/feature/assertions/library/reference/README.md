# Assertion 作者面类型契约

本页说明 root、Session 与 Turn 三层作用域，以及受管 `toolCalls` 与集合匹配的类型边界。

API 包含工具与事件包装、值细化、Judge 定义作为受管 evaluator、Score 写入事件、显式 gate、贡献分、direct score、Usage `ifCovered` 与 `.orStop()`。

类型系统表达合法的作者面组合：

- 参数数量、handle 重用、Pass score 与 direct handle 再配置。
- measurement 的 `gate()` 缺少 minimum、无 condition 的 `orStop()` 缺少 minimum，以及受管 collection 约束。
- 上界 occurrence 与 sequence 传给正向包装，量化 occurrence Match 再进入 `and`、`or`、`inOrder`，以及根 `inOrder`。

运行时数值范围不伪装成静态 literal 类型：
`.score(n)` 与 `t.score(n)` 在运行时拒绝非有限或负值；零分仍是显式 contribution。
`calledTool` 收到 `.exactly(0)` 或 `.atLeast(0)` 时由运行时在登记前拒绝；`.greaterThan(0)` 合法。
数值 matcher 工厂同样在运行时拒绝非有限 threshold；number candidate 为 `NaN` 或正负 `Infinity` 时形成不可用状态。
