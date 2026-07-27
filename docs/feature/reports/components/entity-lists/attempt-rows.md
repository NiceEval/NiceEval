# `sources.entity.attempts`

`sources.entity.attempts` 是 `Table` 数据源,每个 Row 显示一次 Attempt 的判定、单行结果摘要、`totalScore` 与
locator。完整 assertions、diagnostics、cause、stack 与自由文本证据不进入表格 Content;需要完整
结构时经 locator 调 [`resolveLocator`](../../../record/library.md#按-locator-寻址一个-attemptresolvelocator)。

```tsx
const content = await ctx.resolve(sources.entity.attempts);
const rows = content.rows
  .filter((row) => ["failed", "errored"].includes(row.cells.verdict.verdict ?? ""))
  .slice(0, 20);
<Table data={{ ...content, rows }} />
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`sources.entity.experiments`](experiment-rows.md) / [`sources.entity.evals`](eval-rows.md) /
  [`FailureList`](failure-list.md) ——
  其它实体数据源与组合组件。
