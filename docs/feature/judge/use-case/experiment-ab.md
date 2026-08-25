---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 用 Experiment 做裁判 A/B

Eval 保留 rubric、材料和 consumer threshold；Experiment 只选择 Judge 执行配置：

```ts
export default defineEval({
  judge: true,
  async test(t) {
    const turn = await t.send("解释这次修改的风险。");
    turn.check(
      { input: turn.input, output: turn.message },
      closedQA("说明是否覆盖兼容性、回滚与数据风险？").atLeast(0.75),
    ).gate();
  },
});
```

```ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["explanations/"],
  judge: { model: "judge-model-a" },
  labels: { judge: "a" },
});
```

另一个 Experiment 改为不同 `judge.model` 和 label。每个 pair 的冻结配置进入 fingerprint、预检和 evaluator，因此结果可复现地表示实际使用的 Judge。

Eval 可以把 `judge` 声明写成对象来替换某些字段。没有单条 recipe model override 或 CLI model flag；这样所有比较条件都来自 Eval、Experiment 或 Config。
