---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 裁判评质量：规则写不出对错时

“语气是否专业”“说明是否清楚”这类问题没有稳定的精确 Matcher。Judge 用 rubric 和 anchors 描述连续质量量尺，
作者把完成判断所需的应用值组成命名 JSON 材料。

```ts
import { defineEval, defineJudge } from "niceeval";

const professionalTone = defineJudge({
  name: "professional-tone",
  rubric: "评价 draft 是否以清楚、礼貌且专业的语气完成 request。",
});

export default defineEval({
  judge: { model: "judge-model" },
  async test(t) {
    const request = "帮我拟一封跟进邮件。";
    const turn = await t.send(request);
    t.judge({ request, draft: turn.message }, professionalTone)
      .gate(0.8)
      .label("专业语气");
  },
});
```

`defineJudge` 声明稳定 name、rubric、可选 anchors 和材料字节预算。它不包含回调或 Provider；普通自定义
Score Match 仍是纯函数。

Pass 与 Score Eval 都在 measurement handle 上调用 `.gate(minimum)` 形成显式质量门。Score Eval 还可以用
`.score(points)` 让 Measurement 按比例贡献分数；两个 modifier 可任意先后组合，并且只执行一次 Judge。

`judge` 为这条 Eval 指定 Judge 模型配置，不限定可用的 Match。指定字段优先于项目默认值，Experiment 可进一步替换。模型或 Key 缺失时不发网络请求；配置完整后，
实际受管原语以 forced-function 请求并严格校验响应，不另做网络预检。

材料可以直接使用字符串、有限数字、布尔值、null、数组和普通对象。作者应使用体现领域含义的字段名，
并只提供完成本次判断所需的内容；URL 或 alt 不是视觉输入。

## 相关阅读

- [Judge](../../judge/library.md) —— 定义、配置、材料和失败语义。
- [Assertions](../../assertions/README.md) —— Measurement、Threshold 与 `.orStop()`。
- [Score Eval](../../assertions/library/score-points.md) —— Measurement 计分。
