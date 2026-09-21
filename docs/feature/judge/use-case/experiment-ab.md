---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 用 Experiment 做裁判 A/B

Eval 保留 rubric、anchors、材料选择和 consumer threshold；Experiment 只选择模型或整个 Provider：

```ts
const explainsRisk = defineJudge({
  name: "explains-risk",
  rubric: "评价 explanation 是否覆盖 compatibility、rollback 与 dataRisk。",
});

export default defineEval({
  async test(t) {
    const change = "修改持久化字段并提供回滚方案";
    const turn = await t.send(`解释这次修改的风险：${change}`);
    t.judge({ change, explanation: turn.message }, explainsRisk).gate(0.75);
  },
});
```

```ts
import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineExperiment({
  agent: codexAgent(),
  evals: ["explanations/"],
  judgeRuntime: OpenAIProvider({ model: "judge-model-a", timeoutMs: 30_000 }),
  labels: { judge: "openai-a" },
});
```

另一个 Experiment 可把 `judgeRuntime` 换成另一个完整 Provider，或只写模型字符串来保留项目 Provider 的端点、凭据和限制。
每个 pair 的已求值配置进入 execution identity，并由实际 Judge Assertion 使用。

配置求值从 `Config.judgeRuntime` 开始，再应用 `Eval.judge` 和 `Experiment.judgeRuntime`。
最高优先级的 Provider 是整份配置起点，只应用它之后更高层的模型字符串。
没有单条 Assertion 的模型设置或 CLI model flag。
