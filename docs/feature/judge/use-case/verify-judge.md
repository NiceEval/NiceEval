# Judge：接上兼容网关并确认真实判分

把 endpoint、model 和 credential selector 写进可签入配置。key 只来自进程变量：

```ts
export default defineConfig({
  judge: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  },
});
```

写一个显式声明 capability 的 Eval，并硬消费 Judge ScoreFact：

```ts
export default defineEval({
  judge: true,
  async test(t) {
    const fact = t.judge.autoevals.closedQA("文本是否表达成功？", {
      input: "operation completed successfully",
      output: "operation completed successfully",
    });
    t.assert(fact, { atLeast: 0.8 });
  },
});
```

运行 `niceeval exp judge-smoke`。配置了 model 与 key 时，Runner 会先预检 endpoint。预检失败使受影响 Attempt 成为 setup error；它不会生成伪造的 Judge Fact。

预检通过后，show 中应出现一个 ScoreFact 和它的 verdict use。分数是 `[0,1]`；rationale 在 `explanation`，判分材料在 `evidence`。网络调用失败记为 Fact `unavailable`，因此这个硬 use 让 Attempt `errored`；无效模型响应记 evaluator error。

开发机没有 model 或 key 时，不产生预检网络请求。消费 Judge Fact 后，结果显示 `judge-model-unresolved` 或 `judge-key-unresolved (...)`，Attempt 仍为 `errored`。用普通 Fact/use 处理这个结果，不提供允许 Judge 缺席的链式 API。
