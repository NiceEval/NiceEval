# `AttemptAssessment`

`AttemptAssessment` 只表达 source / assertions fallback：先呈现 `attemptError`，有 source 时把
`attemptSource` 交给 `SourceView`，否则把 `attemptAssertions` 交给 `Table`。

```tsx
export const AttemptAssessment = defineComponent((_props, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error("AttemptAssessment requires an attempt-input page");
  }
  return (
    <Col>
      <Callouts source={attemptError} />
      {ctx.page.evidence.capabilities.source
        ? <SourceView source={attemptSource} />
        : <Table source={attemptAssertions} />}
    </Col>
  );
});
```

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`attemptSource`](attempt-source.md) —— 有 source 时使用的区块，含 web 面视觉规范。
- [`AttemptDetail`](attempt-detail.md) —— 把本组件摆进内建排列顺序的组合件。
