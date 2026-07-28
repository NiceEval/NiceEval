# `AttemptAssessment`

`AttemptAssessment` 只表达 source / assertions fallback。它先呈现 `AttemptNotices`；有 source 时把
`sources.attempt.source` 交给 `SourceView`，否则把 `sources.attempt.assertions` 交给 `Table`。

```tsx
export const AttemptAssessment = defineComposition((_props, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error("AttemptAssessment requires an attempt-input page");
  }
  return (
    <Col>
      <AttemptNotices />
      {ctx.page.evidence.capabilities.source
        ? <SourceView source={sources.attempt.source} />
        : <Table source={sources.attempt.assertions} />}
    </Col>
  );
});
```

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`sources.attempt.source`](../sources/attempt-source.md) —— 有 source 时使用的区块，含 web 面视觉规范。
- [`AttemptDetail`](attempt-detail.md) —— 把本组件摆进内建排列顺序的组合件。
