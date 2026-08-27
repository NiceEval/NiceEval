# 用 Judge Graph 评估多项材料

在 Grading callback 内，把需要的材料作为具名槽交给一个静态 recipe。配方内部可以检查多个维度，并以版本化、确定性规则产生一个最终 measurement。

```ts
const turn = g.turn("answer");
const reference = g.material.referenceText({
  name: "expected-answer",
  text: "回答应给出结论、依据与可执行步骤。",
});

const check = judge.check({
  recipe: answerQualityRecipe,
  material: {
    question: turn.material.input,
    answer: turn.material.reply,
    reference,
  },
});

g.judge.llm(check).atLeast(0.8).label("答案质量");
```

这在 Pass Eval 中登记一条 condition。Score Eval 使用同一 handle 的 `.score(5)`，不复制 recipe，也不启动第二个 evaluator。

读取面显示最终 measurement、rationale、材料引用、recipe identity 与 visible manifest。内部节点不是用户可见的 Assertion，也不能读取未绑定的 Action result。
