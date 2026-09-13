---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是一种受管、异步的特殊 Match。普通 `CustomScoreMatch` 保持纯函数；只有 NiceEval 创建的
`JudgeMatch` 可以使用模型 I/O。`t.check(check, judge.llm())` 登记一条 Assertion，Judge 只产出有限
`[0,1]` measurement 与公开 rationale，不自行决定 Verdict 或 score。

Judge 的输入不是任意 `{ input, output }`。Eval 先用 `defineJudge` 封口允许使用的声明式 recipe 与定义期参考
材料；运行时再用 `judge.check` 把当前 Turn 的受管 View 绑定到 recipe slot。自定义 recipe 只有 identity、
有序 slots、rubric、anchors 和字节预算，没有 callback、provider、threshold 或评分策略。

```ts
const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "回答是否解释了风险？" }),
  },
});

export default defineEval({
  judge: judging,
  async test(t) {
    const turn = await t.send("解释风险。");
    const check = judge.check({
      recipe: judging.recipes[0],
      material: {
        task: turn.material.input,
        reply: turn.material.reply,
        criterion: judging.material.criterion,
      },
    });
    turn.check(check, judge.llm().atLeast(0.8)).gate();
  },
});
```

内建 `closedQA`、`factuality`、`summarizes` 是固定 recipe descriptor；criterion、expected、source 都是
显式 definition-reference slot。相同机制也允许用户声明自己的 recipe。

| 目的 | 入口 |
|---|---|
| API、内建与自定义 recipe、配置、失败 | [Library](library.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
