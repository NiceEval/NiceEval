---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Judge：选择 Provider 并确认真实评估

从 `niceeval/judge` 导入具名工厂，把服务、model、endpoint 和 credential selector 绑定为一个 Provider。
key 只来自进程变量：

```ts
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  }),
});
```

Vercel AI Gateway 改用 `VercelProvider`，OpenRouter 改用 `OpenRouterProvider`，TypeSafe System One 改用
`TypesafeProvider`。它们都从 `niceeval/judge` 导出；不依靠 hostname、模型名或已存在的 key 猜测服务。

写一个声明评分标准的 Pass Eval。材料使用应用语义明确的字段，最低值由同一 Assertion handle 声明：

```ts
const expressesSuccess = defineJudge({
  name: "expresses-success",
  rubric: "根据 operation 与 response 评价回复是否明确表达操作成功。",
});

export default defineEval({
  judge: "judge-model",
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

开发机没有 Provider 或 key 时不会发出网络请求。结果保留 `judge-provider-unresolved` 或
`judge-key-unresolved`，让读者区分配置缺失与被测对象质量。
