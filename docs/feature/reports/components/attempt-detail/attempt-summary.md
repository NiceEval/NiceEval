# `AttemptSummary`

`AttemptSummary` 回答「这是谁、判定是什么」。它是消费 `AttemptSnapshot` 的普通 Component，
接受 [`sources.attempt.snapshot`](README.md#page-输入与数据源)；page resolve 会复用这次计算。
它恒有输出：snapshot 对任何 attempt 都存在。

```tsx
<AttemptSummary source={sources.attempt.snapshot} />
```

```ts
type AttemptSummaryProps = DataProps<AttemptEvidence, AttemptSnapshot> & {
  locale?: ReportLocale;
  className?: string;
};
```

- text 面：紧凑身份与 verdict 摘要，计分制含本轮挣分。
- web 面：verdict pill 与 locator 头行是详情标题，其余（开始时刻、耗时、成本，计分制含
  本轮挣分）为统计卡。
- 它不消费维度（`dimensions: () => ({})`）：身份与判定用文字与状态色表达，
  不参与页级身份分配。

错误事实（`AttemptSnapshot.error`）的产品解释归 [`AttemptNotices`](attempt-notices.md)；
本组件只陈列身份与读数，不生成 action。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与在 show / view 的两面对照。
- [`AttemptUsage`](attempt-usage.md) —— 同一 snapshot usage 的数值表。
