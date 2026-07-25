# `AttemptAssessment`

`AttemptAssessment` 只表达 source / assertions fallback：先放 `AttemptError`，有 source 时放 `AttemptSource`，否则放 `AttemptAssertions`；子组件都为空时零输出。区块在整体装配里的位置见[公开区块集](README.md#公开区块集)。

```tsx
export const AttemptAssessment = defineComponent((_props, ctx) => {
  if (ctx.page.input !== "attempt") {
    throw new Error("AttemptAssessment requires an attempt-input page");
  }
  return (
    <Col>
      <AttemptError />
      {ctx.page.evidence.capabilities.source
        ? <AttemptSource />
        : <AttemptAssertions />}
    </Col>
  );
});
```

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`AttemptSource`](attempt-source.md) —— 有 source 时使用的区块，含 web 面视觉规范。
- [`AttemptDetail`](attempt-detail.md) —— 把本组件摆进内建排列顺序的组合件。
