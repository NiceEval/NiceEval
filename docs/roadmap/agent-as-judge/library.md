# Agent-as-Judge —— Library

Agent Judge recipe 声明 rubric、材料与执行范围：

```ts
const review = turn.judge.agent({
  rubric: "检查回答是否准确、完整且可执行。",
  material: { answer: turn.message },
});

review.atLeast(0.8).label("回答质量");
```

rubric 可以用 anchors 描述 measurement 的可观察含义。anchor 数值在 `[0,1]` 内严格递增，且都描述同一维度；它们只帮助 evaluator 校准，不是累计 score。

Pass Eval 中 measurement 必须 `.atLeast(n)`。Score Eval 中可 `.score(n)`，并可额外 `.atLeast(n)`。threshold、score contribution 和 `.orStop()` 都是同一 AssertionHandle 的配置。
