# `EvalList`

每项表示 `experimentId + evalId`。父行显示折叠判定、Attempt 数、聚合分数、平均耗时和平均成本，展开后由每个 Attempt 子行分别显示该轮的主失败摘要或结构化错误摘要。比较层不展开全部 assertions，也不在 Eval 父行复述某个 Attempt 的失败内容。数据形状见[实体列表](README.md#数据形状)。

```tsx
const items = await evalListData(ctx.scope);
<EvalList data={items.filter((x) => x.verdict !== "passed")} />
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`ExperimentList`](experiment-list.md) / [`AttemptList`](attempt-list.md) / [`FailureList`](failure-list.md) —— 其它实体列表。
