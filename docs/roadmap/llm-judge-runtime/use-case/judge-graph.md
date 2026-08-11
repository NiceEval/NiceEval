# 用 Judge Graph 评估多项材料

把需要的材料作为具名槽交给一个静态 recipe。配方内部可以检查多个维度，并以版本化、确定性规则产生一个最终 measurement。

```ts
turn.judge.llm({
  recipe: answerQualityRecipe,
  material: { question: turn.input, answer: turn.message, reference },
}).atLeast(0.8).label("答案质量");
```

这在 Pass Eval 中登记一条 condition。Score Eval 使用同一 handle 的 `.score(5)`，不复制 recipe，也不启动第二个 evaluator。

读取面显示最终 measurement、rationale、材料引用和 recipe identity。内部节点不是用户可见的 Assertion。
