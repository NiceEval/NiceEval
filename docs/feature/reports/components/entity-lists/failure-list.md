# `FailureList`

「现在有哪些失败要处理」是常见固定区块,所以工具箱提供 `FailureList` 组合组件。它与手写装配严格
等价:内部是 `attemptRows.compute(input)` → 过滤 → `<Table data={content}>`,没有私有能力。

- 收 `verdict` 为 `failed` 或 `errored` 的 attempt；
- 按 attempt 开始时间降序（最近的失败在前），同刻按 locator 字典序收口；
- 截断到 `limit`（默认 20），Content 保留截断前总数。

```ts
type FailureListProps = {
  /** 显示的最大条数；默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Sample。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
};
```

```tsx
<FailureList limit={30} />
```

其它筛选口径（只看某个 agent、按成本排序）不属于它——写[组合组件](../../library/layout.md#自定义组件)加工 `attemptRows` 的结果，`FailureList` 只覆盖这一种最常见的问题。

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`experimentRows`](experiment-rows.md) / [`evalRows`](eval-rows.md) / [`attemptRows`](attempt-rows.md)
  —— 其它实体数据源。
