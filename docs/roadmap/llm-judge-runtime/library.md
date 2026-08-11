# 原生 LLM Judge Runtime —— Library

Judge Check 用具名材料角色调用 recipe：

```ts
const check = judge.check({
  recipe: closedQA("回答是否完整？"),
  material: { input: turn.input, output: turn.message },
});

t.judge.llm(check).atLeast(0.8).label("回答完整");
```

recipe 只定义 rubric、输入槽和静态 Judge Graph。profile 只定义 model、endpoint、credential selector、timeout 和执行限制。两者都不携带 threshold、score contribution 或 control。

Score Eval 中，同一 entry 可以改为 `t.judge.llm(check).score(5).atLeast(0.8)`。threshold 只增加局部 condition，不改变 score。
