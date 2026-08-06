# 评价 Direct Agent 的多轮回答

## 解决什么问题

客服 Agent 的答案不能只看最后一句。
裁判需要回看多轮承诺、核对是否前后矛盾，并按统一锚点给出一个可比较分数，但不需要文件系统或命令工具。

## 全流程

Experiment 为被测 Agent 与 Direct Agent Judge 分别声明连接。

```ts
// experiments/support.ts
import { defineExperiment } from "niceeval";
import { supportAgent, reviewAgent } from "../agents";

export default defineExperiment({
  agent: supportAgent({ apiKeyEnv: "SUPPORT_AGENT_KEY" }),
  judge: {
    agent: {
      agent: reviewAgent({ apiKeyEnv: "REVIEW_AGENT_KEY" }),
      model: "gpt-5.4",
      reasoningEffort: "high",
      timeoutMs: 5 * 60_000,
    },
  },
});
```

Eval 在主 Session 上声明 rubric，因此默认材料是完整对话。

```ts
// evals/refund-policy.eval.ts
import { defineEval } from "niceeval";

export default defineEval({
  description: "客服解释退款规则时保持准确且前后一致",
  async test(t) {
    await t.send("我买了 40 天，已经拆封，还能全额退款吗？");
    await t.send("你刚才说特殊情况可以，那到底需要什么证明？");

    t.judge.agent({
      name: "退款说明质量",
      criterion: "客服是否准确说明规则、前后一致，并明确区分常规条件与例外？",
      anchors: [
        { score: 0, description: "规则错误、前后矛盾，或承诺无条件退款" },
        { score: 0.5, description: "主要规则正确，但例外条件含糊或有轻微矛盾" },
        { score: 1, description: "规则与例外都准确，证据要求清楚，且多轮口径一致" },
      ],
    }).atLeast(0.8);
  },
});
```

Runner 把对话作为不可信 evidence 交给裁判。
裁判的 model、事件、usage 与 rationale 单独记录，不进入被测 Agent 的工具计数或 token 读数。

## 契约连接

- 默认材料与 rubric 形状见 [Library · 默认材料与工作区](../library.md#默认材料与工作区)。
- 两套凭据必须分开，见 [README · 安全边界](../README.md#安全边界)。
- 裁判成本与被测成本分列，见 [Architecture · 执行与结果边界](../architecture.md#执行与结果边界)。

