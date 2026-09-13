---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 用 Experiment 做裁判 A/B

Eval 保留 rubric、anchors、材料选择和 consumer threshold；Experiment 只选择 Judge 执行配置：

```ts
const explainsRisk = defineJudge({
  name: "explains-risk",
  rubric: "评价 explanation 是否覆盖 compatibility、rollback 与 dataRisk。",
});

export default defineEval({
  judge: explainsRisk,
  async test(t) {
    const change = "修改持久化字段并提供回滚方案";
    const turn = await t.send(`解释这次修改的风险：${change}`);
    t.judge({ change, explanation: turn.message }, explainsRisk).gate(0.75);
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

Eval 的 `judge` 只保存评分定义。没有单条 Judge model override 或 CLI model flag；执行配置只来自 Experiment 或 Config 的 `judgeRuntime`。
