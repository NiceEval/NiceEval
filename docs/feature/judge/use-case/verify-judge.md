---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Judge：接上兼容网关并确认真实评估

把 endpoint、model 和 credential selector 写进可签入配置。key 只来自进程变量：

```ts
export default defineConfig({
  judgeRuntime: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  },
});
```

写一个声明评分定义的 Pass Eval，并在同一 handle 上设 threshold：

```ts
const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "文本是否表达成功？" }),
  },
});

export default defineEval({
  judge: judging,
  async test(t) {
    const turn = await t.send("operation completed successfully");
    const check = judge.check({
      recipe: judging.recipes[0],
      material: {
        task: turn.material.input,
        reply: turn.material.reply,
        criterion: judging.material.criterion,
      },
    });
    t.check(check, judge.llm().atLeast(0.8)).gate().label("成功表达");
  },
});
```

运行 `niceeval exp judge-smoke`。完整配置会先预检 endpoint；预检失败是 setup error，不会生成伪造的
Judge 结果。

预检通过后，View 或固定 query 显示一条 Judge AssertionResult，其中含 `[0,1]` measurement、threshold、理由和
裁剪后的材料。网络调用失败为 `unavailable`，无效响应为 evaluator `errored`；二者都不会显示为 `0`。

开发机没有 model 或 key 时不会发出预检网络请求。结果保留 `judge-model-unresolved` 或
`judge-key-unresolved`，让读者区分配置缺失与被测对象质量。
