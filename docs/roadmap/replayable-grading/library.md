# 可重评分 Eval —— Library

Replayable Library 以两个显式值工作：sealed execution graph 与 versioned GradingDefinition。

```ts
const definition = defineGrading({
  version: "answer-quality/v2",
  evaluationKind: "score",
  async grade(g) {
    const turn = g.turn("answer");
    const expected = g.material.referenceText({
      name: "expected-answer",
      text: "回答应说明原因、修复步骤与验证结果。",
    });

    const check = judge.check({
      recipe: answerQuality,
      material: {
        task: turn.material.input,
        reply: turn.material.reply,
        expected,
      },
    });

    g.judge.llm(check)
      .score(5)
      .atLeast(0.8);
  },
});

const claim = await gradeExecution(execution, definition);
```

`g.turn(name)` 只查找该 Execution graph 中的具名 Turn ref；返回的 `turn.material` 与在线 Turn 使用相同的私有品牌 View。Definition reference/custom 的入口和阶段边界见 [Judge Material](../judge-runtimes/material/library.md#自定义与参考材料)。

`gradeExecution` 读取 sealed semantic refs，注册新的 Assertion entries，并返回新的 immutable Claim。它不修改 Execution，不重新调用被测 Agent，也不从旧 AssertionResult、Attachment blob 或未保存的 inline value 复原材料。

Pass GradingDefinition 中 measurement 使用 `.gate(n)` 才进入 failed。Score GradingDefinition 中 Assertion 默认
record-only；`.score(n)` 或 direct score 才贡献累计 score。

`gradeExecution(execution, definition, { force: true })` 只绕过合格 Judge Evaluation 的复用，创建新的 Evaluation occurrence 与 Claim。它不会重新执行 Agent。
