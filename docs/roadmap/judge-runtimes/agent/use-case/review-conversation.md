# 审查多轮对话

把需要审查的 Turn 逐个作为明确材料交给独立 Agent Judge：

```ts
const check = judge.check({
  recipe: supportPolicyReview,
  material: {
    customerQuestion: questionTurn.material.input,
    firstReply: questionTurn.material.reply,
    clarification: clarificationTurn.material.input,
    finalReply: clarificationTurn.material.reply,
  },
});

const review = t.judge.agent(check, {
  agent: reviewer,
  tools: [],
  network: "none",
});

review.atLeast(0.8).label("客服政策说明");
```

没有 `session.snapshot()`、隐式 last Turn 或全 Session trace。每个 View 保留所属 Session 的 local ordinal；跨 Session 组合只保留各自顺序，并把作者排列标记为非因果顺序。

裁判 Agent 只能读取交付的内容，不能改变被测 Session。它返回 measurement、公开 rationale 与 evidence refs；Pass projection 根据 threshold 形成 condition。

Score Eval 中使用 `review.score(5)` 让同一次裁判运行贡献 score。
