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
  judge: { timeoutMs: 30_000 },
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

另一个 Experiment 改为不同 `judgeRuntime.model` 和 label。每个 pair 的已求值配置进入 execution identity，并由实际 Judge Assertion 使用，因此结果可复现地表示实际使用的 Judge。

Eval 的 `judge` 按字段替换默认 Judge 配置。有效配置按 `Experiment.judgeRuntime → Eval.judge → Config.judgeRuntime → 内置默认`
求值；每个 `Eval × Experiment` 的结果都带这份 execution identity。没有单条 Assertion 的模型设置或 CLI model flag。
