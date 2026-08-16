# Assertion 作者面类型原型

[type-prototype.ts](type-prototype.ts) 是文档中的可编译类型边界。它说明 root、Session、Turn 三层 scope，
值 refinement、Pass threshold、Score record-only、贡献 score、direct score、Usage `ifCovered` 与 `.orStop()`。

正向示例说明允许的作者面。`@ts-expect-error` 说明禁止的参数数、handle 重用、Pass score、direct handle
再配置、未 threshold 的 Pass measurement，以及旧 API。运行时数值范围不伪装成静态 literal 类型：
`.score(n)` 在运行时拒绝非有限或不大于零的值，`t.score(n)` 拒绝非有限或负值。

从仓库根运行：

```sh
pnpm exec tsc -p docs/feature/assertions/reference/tsconfig.json
```
