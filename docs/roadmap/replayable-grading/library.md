# 可重评分 Eval —— Library

Replayable Library 以两个显式值工作：sealed execution graph 与 versioned GradingDefinition。

```ts
const definition = defineGrading({
  version: "answer-quality/v2",
  evaluationKind: "score",
  async grade(g) {
    g.turn("answer").judge.autoevals.closedQA("回答是否完整？")
      .score(5)
      .atLeast(0.8);
  },
});

const claim = await gradeExecution(execution, definition);
```

`gradeExecution` 读取 sealed refs，注册新的 Assertion entries，并返回新的 immutable claim。它不修改
`execution`，不重新调用被测 Agent，也不从旧 AssertionResult 复原未保存的 inline value。

Pass GradingDefinition 中 measurement 必须 `.atLeast(n)`。Score GradingDefinition 中 Assertion 默认
record-only；`.score(n)` 或 direct score 才贡献累计 score。
