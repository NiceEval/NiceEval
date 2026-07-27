# `AttemptDetail`

`AttemptDetail` 只表达内建排列顺序，全文是：

```tsx
export const AttemptDetail = defineComposition((_props, ctx) => {
  const conversationLivesInSource =
    ctx.page.input === "attempt" &&
    ctx.page.evidence.capabilities.source &&
    ctx.page.evidence.evalSource !== null;
  return (
    <Col>
      <AttemptSummary source={sources.attempt.snapshot} />
      <AttemptAssessment />
      <AttemptFixPrompt />
      <Waterfall source={sources.attempt.timeline} />
      <AttemptUsage source={sources.attempt.snapshot} />
      {conversationLivesInSource
        ? null
        : <Conversation source={sources.attempt.conversation} />}
      <Waterfall source={sources.attempt.trace} />
      <DiffView source={sources.attempt.diff} />
    </Col>
  );
});
```

它不接受结构子节点：要换顺序或删区块，就在参数化 page 里直接摆公开区块，不需要复制 view：

```tsx
{
  id: "attempt",
  title: "Failure review",
  input: "attempt",
  navigation: false,
  content: (
    <Col>
      <AttemptSummary source={sources.attempt.snapshot} />
      <AttemptAssessment />
      <DiffView source={sources.attempt.diff} />
      <Conversation source={sources.attempt.conversation} />
    </Col>
  ),
}
```

报告没有 attempt-input page 时，locator 在 web / text 两面都只显示为普通文本，宿主不追加官方详情作为 fallback。自有 React 页面仍可通过组件自己的 `attemptHref` 显式接到外部路由。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集、page 输入形态与在 show / view 怎样渲染。
- [`AttemptAssessment`](attempt-assessment.md) —— 本组件内部使用的 source / assertions fallback。
