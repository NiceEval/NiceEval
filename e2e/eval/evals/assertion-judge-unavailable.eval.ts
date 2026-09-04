import { defineEval, defineJudge, judge } from "niceeval";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "回复是否含确定性 marker？" }),
  },
});

export default defineEval({
  description:
    "声明 Judge capability 但未配置模型时，Judge Assertion 以 unavailable 使 Attempt errored，且不发网络请求",
  judge: judging,
  async test(t) {
    const turn = await t.send("assertion/judge");
    turn.succeeded();

    // No Judge model is configured in niceeval.config.ts. This Assertion must
    // take the documented zero-network unavailable path.
    const check = judge.check({
      recipe: judging.recipes[0],
      material: {
        task: turn.material.input,
        reply: turn.material.reply,
        criterion: judging.material.criterion,
      },
    });
    turn.check(check, judge.llm().atLeast(1))
      .gate()
      .label("Judge marker");
  },
});
