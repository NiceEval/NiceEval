---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 裁判评质量：规则写不出对错时

“语气是否专业”“说明是否清楚”这类问题没有稳定的精确 Matcher。Judge 用声明式 Recipe 描述评分维度，
再把一个 Turn 的受管输入与回复交给独立裁判模型。

```ts
import { defineEval, defineJudge, judge } from "niceeval";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "语气是否专业？" }),
  },
});

export default defineEval({
  judge: judging,
  async test(t) {
    const turn = await t.send("帮我拟一封跟进邮件。");
    const check = judge.check({
      recipe: judging.recipes[0],
      material: {
        task: turn.material.input,
        reply: turn.material.reply,
        criterion: judging.material.criterion,
      },
    });
    turn.check(check, judge.llm().atLeast(0.8))
      .gate()
      .label("专业语气");
  },
});
```

`defineJudge` 的 Recipe 也可以由用户声明。它只能包含稳定 Identity、有序 Slot、Rubric、Anchors 和字节预算，
不能包含回调或 Provider。普通自定义 Score Match 仍是纯函数。

Pass Eval 先在 `JudgeMatch` 上配置 Threshold，再在 Handle 上调用 `.gate()`。Score Eval 可以用
`.score(points)` 让 Measurement 按比例贡献分数。两种方式都只执行一次 Judge。

未声明 `judge`、使用另一份声明的 Recipe 或参考 View、跨 Turn 混用 View 都是同步作者错误。模型或 Key
缺失时不发网络请求；配置完整后才执行 forced-function 预检。

V1 只提供 Turn Input、Turn Reply 和定义期 Reference Text View。文件、Action Result、多模态与 Session
View 属于 Judge Material Roadmap，不接受原始字符串作为替代。

## 相关阅读

- [Judge](../../judge/library.md) —— Recipe、配置、材料和失败语义。
- [Assertions](../../assertions/README.md) —— Measurement、Threshold 与 `.orStop()`。
- [Score Eval](../../assertions/library/score-points.md) —— Measurement 计分。
