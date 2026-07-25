# `FailureList`

「现在有哪些失败要处理」是每份报告都要的固定区块，所以工具箱直接提供成品组合件，不用每个报告重写同一段取数过滤。它与手写组合组件严格等价：内部就是 `attemptListData` → 过滤 → `AttemptList` data 形态，没有私有能力。

- 收 `verdict` 为 `failed` 或 `errored` 的 attempt；
- 按 attempt 开始时间降序（最近的失败在前），同刻按 locator 字典序收口；
- 截断到 `limit`（默认 20），`AttemptList` 的 `total` 报告截断前总数。

```ts
type FailureListProps = {
  /** 显示的最大条数；默认 20。 */
  limit?: number;
  /** 默认宿主注入的 Scope。 */
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
};
```

```tsx
<FailureList limit={30} />
```

其它筛选口径（只看某个 agent、按成本排序）不属于它——写[组合组件](../../library/layout.md#自定义组件)加工 `attemptListData` 的结果，`FailureList` 只覆盖这一种最常见的问题。

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`ExperimentList`](experiment-list.md) / [`EvalList`](eval-list.md) / [`AttemptList`](attempt-list.md) —— 其它实体列表。
