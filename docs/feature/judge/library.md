# Judge —— Library

`niceeval` 与 `niceeval/expect` 导出 `defineJudge`、`judge` 和 `judgeRecipes`。推荐使用 `judge.recipes`。

## 声明与绑定

```ts
const answerQuality = {
  identity: "acme.answer-quality/v1",
  slots: [
    { name: "task", role: "task", accepts: ["turn-input"], maxBytes: 16_384 },
    { name: "reply", role: "candidate", accepts: ["turn-reply"], maxBytes: 16_384 },
    { name: "policy", role: "definition-reference", accepts: ["reference-text"], maxBytes: 4_096 },
  ],
  rubric: "Measure whether the reply follows the answer policy.",
  anchors: [
    { measurement: 0, description: "does not follow the policy" },
    { measurement: 1, description: "fully follows the policy" },
  ],
  maxRenderedBytes: 36_864,
} as const;

const judging = defineJudge({
  recipes: [answerQuality],
  material: {
    policy: judge.referenceText({ name: "policy", text: "State uncertainty explicitly." }),
  },
});
```

`defineJudge` 冻结 recipe 与参考材料，并把其 canonical digest 纳入 evaluation identity。同一声明内相同
identity 对应不同内容会在 planning 前报错。`judge.referenceText` 返回的输入 View 不能直接绑定；只有
`defineJudge` 返回的 owned View 才能满足 definition-reference slot。

```ts
const turn = await t.send("回答这个问题。");
const check = judge.check({
  recipe: judging.recipes[0],
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
    policy: judging.material.policy,
  },
});

t.check(check, judge.llm().atLeast(0.8)).gate().label("回答质量");
```

所有 slot 都 required，并按 tuple 顺序渲染。缺失、多余、错误 kind/role、跨 declaration 的参考 View、跨
Turn 的执行 View 和超出单 slot/总字节预算都会同步拒绝，不创建 Assertion。普通 object 即使形状相同也不能
伪造 Material View、JudgeCheck 或 JudgeMatch。

## 内建 recipe

- `judge.recipes.closedQA`：definition-reference slot 名为 `criterion`，anchors 为 `0/1`。
- `judge.recipes.factuality`：参考答案 slot 名为 `expected`。
- `judge.recipes.summarizes`：待总结原文 slot 名为 `source`。

内建 recipe 不接收参数。事实材料必须通过 `judge.referenceText` 进入 `defineJudge`，因此 recipe digest 与实际
参考材料不会形成两套身份。

## Runtime 配置

Eval 的 `judge` 只声明能力定义；Experiment 与项目配置的 `judgeRuntime` 只声明 Provider Profile：

```ts
export default defineConfig({
  judgeRuntime: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
    timeoutMs: 120_000,
    maxOutputTokens: 512,
  },
});
```

Runtime identity 包含 model、endpoint、credential selector、timeout、输出上限和固定渲染/安全/Decision
协议，但不保存 credential value。V1 没有单条 recipe provider override 或 maxCost。

完整配置会先用同一 forced-function Decision protocol 预检。模型或 key 缺失时不发网络请求并报告
`unavailable`；端点不支持 tool 是 setup error；请求传输失败/超时为 `unavailable`；非法 Decision 为
`errored`；取消保持 Effect Interrupt。响应在读取 JSON 前受硬字节上限保护。

成功请求保存实际发送的 versioned `MaterialBindingManifest`；未发请求时不伪造 presentation。旧 criterion
字段不会被新 runtime 解释。
