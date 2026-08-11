# 审查多轮对话

把需要审查的 Turn 与上下文作为明确材料交给独立 Agent Judge：

```ts
const review = session.judge.agent({
  rubric: supportPolicyRubric,
  material: { conversation: session.snapshot(), finalReply: turn.message },
});

review.atLeast(0.8).label("客服政策说明");
```

裁判 Agent 只能读取交付的内容，不能改变被测 Session。它返回 measurement、rationale 与 evidence 引用；Pass projection 根据 threshold 形成 condition。

Score Eval 中使用 `review.score(5)` 让同一次裁判运行贡献 score。
