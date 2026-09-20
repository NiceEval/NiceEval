---
format: concord.document/v1
id: verify-judge
title: Judge：接上兼容网关并确认真实评估
createdAt: 2026-07-25T12:46:34+08:00
kind: use-case
feature: docs/feature/judge/README.md
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

写一个声明评分标准的 Pass Eval。材料使用应用语义明确的字段，最低值由同一 Assertion handle 声明：

```ts
const expressesSuccess = defineJudge({
  name: "expresses-success",
  rubric: "根据 operation 与 response 评价回复是否明确表达操作成功。",
});

export default defineEval({
  judge: { model: "judge-model" },
  async test(t) {
    const operation = "完成数据导入";
    const turn = await t.send(operation);
    t.judge({ operation, response: turn.message }, expressesSuccess)
      .gate(0.8)
      .label("成功表达");
  },
});
```

运行 `niceeval exp judge-smoke`。静态配置校验不请求 endpoint；实际 Judge Assertion 的 forced-function 请求
才验证兼容性，不会生成伪造的 Judge 结果。

调用完成后，View 或固定 query 显示一条 Judge AssertionResult，其中含 `[0,1]` measurement、threshold、理由和
裁剪后的材料。网络调用失败为 `unavailable`，无效响应为 evaluator `errored`；二者都不会显示为 `0`。

开发机没有 model 或 key 时不会发出网络请求。结果保留 `judge-model-unresolved` 或
`judge-key-unresolved`，让读者区分配置缺失与被测对象质量。
