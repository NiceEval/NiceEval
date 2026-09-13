# Assertion 作者面类型原型

[type-prototype.ts](type-prototype.ts) 是文档中的可编译类型边界。它说明 root、Session、Turn 三层 scope，
以及受管 `toolCalls` 与 collection Match。

它还说明工具与 event 包装糖、值 refinement、Judge 定义作为受管 evaluator、Score record-only、显式 gate、贡献 score、direct score、Usage `ifCovered` 与 `.orStop()`。

正向示例说明允许的作者面。`@ts-expect-error` 只说明当前 API 的结构性非法组合：

- 参数数、handle 重用、Pass score 与 direct handle 再配置；
- measurement 的 `gate()` 缺 minimum、无 condition 的 `orStop()` 缺 minimum，以及受管 collection 约束；
- 上界 occurrence／sequence 传给正向包装，量化 occurrence Match 再进入 `and`／`or`／`inOrder`，以及根 `inOrder`。

它不为已经移除的作者语法保留守墓式类型断言。
运行时数值范围不伪装成静态 literal 类型：
`.score(n)` 与 `t.score(n)` 在运行时拒绝非有限或负值；零分仍是显式 contribution。
`calledTool` 收到 `.exactly(0)`／`.atLeast(0)` 时由运行时在登记前拒绝；`.greaterThan(0)` 合法。
数值 matcher 工厂同样在运行时拒绝非有限 threshold；number candidate 为 `NaN` 或正负 `Infinity` 时则形成 unavailable。

从仓库根运行：

```sh
pnpm exec tsc6 -p docs/feature/assertions/reference/tsconfig.json
```
