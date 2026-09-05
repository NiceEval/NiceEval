---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 用 Experiment 做裁判 A/B

Eval 保留 rubric、材料和 consumer threshold；Experiment 只选择 Judge 执行配置：

```ts
const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "说明是否覆盖兼容性、回滚与数据风险？" }),
  },
});

export default defineEval({
  judge: judging,
  async test(t) {
    const turn = await t.send("解释这次修改的风险。");
    const check = judge.check({
      recipe: judging.recipes[0],
      material: { task: turn.material.input, reply: turn.material.reply, criterion: judging.material.criterion },
    });
    turn.check(check, judge.llm().atLeast(0.75)).gate();
  },
});
```

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["explanations/"],
  judgeRuntime: { model: "judge-model-a" },
  labels: { judge: "a" },
});
```

另一个 Experiment 改为不同 `judgeRuntime.model` 和 label。每个 pair 的冻结配置进入 fingerprint、预检和 evaluator，因此结果可复现地表示实际使用的 Judge。

Eval 的 `judge` 只保存评分定义。没有单条 recipe model override 或 CLI model flag；执行配置只来自 Experiment 或 Config 的 `judgeRuntime`。
