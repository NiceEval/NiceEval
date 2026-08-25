# Assertion 作者面类型原型

[type-prototype.ts](type-prototype.ts) 是文档中的可编译类型边界。它说明 root、Session、Turn 三层 scope，
以及受管 `toolCalls` 与 collection Match。

它还说明工具与 event 包装糖、值 refinement、登记前 threshold、Judge `ScoreMatch`、Score record-only、贡献 score、direct score、Usage `ifCovered` 与 `.orStop()`。

正向示例说明允许的作者面。`@ts-expect-error` 只说明当前 API 的结构性非法组合：

- 参数数、handle 重用、Pass score 与 direct handle 再配置；
- 未 threshold 的 measurement 调用 `gate()`／`orStop()`，以及受管 collection 约束；
- 上界 occurrence／sequence 传给正向包装，量化 occurrence Match 再进入 `and`／`or`／`inOrder`，以及根 `inOrder`。

它不为已经移除的作者语法保留守墓式类型断言。
运行时数值范围不伪装成静态 literal 类型：
`.score(n)` 在运行时拒绝非有限或不大于零的值，`t.score(n)` 拒绝非有限或负值。
`calledTool` 收到 `.exactly(0)`／`.atLeast(0)` 时由运行时在登记前拒绝；`.greaterThan(0)` 合法。
数值 matcher 工厂同样在运行时拒绝非有限 threshold；number candidate 为 `NaN` 或正负 `Infinity` 时则形成 unavailable。

从仓库根运行：

```sh
pnpm exec tsc6 -p docs/feature/assertions/reference/tsconfig.json
```
