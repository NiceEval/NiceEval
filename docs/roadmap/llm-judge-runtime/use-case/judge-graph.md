# 组合一张判分图

这个配方把事实一致性和任务可用性分开判分，再用固定权重聚合。
两个模型节点互不依赖，Runtime 可以在 profile 并发预算内同时执行。

```ts
import { defineEval } from "niceeval";
import { defineJudgeGraph, material } from "niceeval/judge";

const answerQuality = defineJudgeGraph({
  id: "acme/answer-quality",
  version: 1,
  inputs: {
    candidate: { kind: "material", required: true },
    reference: { kind: "material", required: true },
  },
  build(g, input) {
    const factuality = g.model("factuality", {
      rubric: "candidate 的具体事实和数字是否都能由 reference 支持。",
      on: [input.candidate, input.reference],
    });
    const usefulness = g.model("usefulness", {
      rubric: "candidate 是否直接、完整地帮助用户完成任务。",
      on: [input.candidate],
    });

    return g.weightedMean("overall", [
      { from: factuality, weight: 0.7 },
      { from: usefulness, weight: 0.3 },
    ]);
  },
});

export default defineEval({
  judge: { llm: { uses: { default: { media: ["text"] } } } },
  async test(t) {
    await t.send("根据工具返回的库存信息，给出补货建议。");

    t.judge.llm({
      recipe: answerQuality,
      input: {
        candidate: material.current({ id: "answer", role: "candidate" }),
        reference: material.text(expectedInventory, {
          id: "inventory",
          role: "reference",
        }),
      },
    }).atLeast(0.85);
  },
});
```

图编译结果包含 `factuality`、`usefulness` 和 `overall` 三个稳定节点。
只有 `overall` 的 Decision 形成 Assertion Claim；两个分项、聚合过程与物理请求都进入带同一 correlation 的 judge
Observation stream，并由最终 Judge Claim 引用。它们不写入 `judge.json` 或 Attempt payload。

某个模型节点请求失败时，`overall` 因依赖 unavailable 而 unavailable。
配方只有显式使用 `g.fallback(...)`，才能用另一个节点结果继续产生 Decision。
这个规则避免网关错误被聚合器当成 0 分，也避免静默改变权重分母。
