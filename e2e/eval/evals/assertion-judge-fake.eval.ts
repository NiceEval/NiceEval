import { defineEval, defineJudge, judge } from "niceeval";

const judging = defineJudge({
  recipes: [{
    identity: "niceeval.e2e.marker-quality/v1",
    slots: [
      { name: "task", role: "task", accepts: ["turn-input"], maxBytes: 1_024 },
      { name: "reply", role: "candidate", accepts: ["turn-reply"], maxBytes: 1_024 },
      { name: "criterion", role: "definition-reference", accepts: ["reference-text"], maxBytes: 1_024 },
    ],
    rubric: "Measure whether the reply satisfies the marker criterion.",
    anchors: [
      { measurement: 0, description: "does not contain the marker" },
      { measurement: 1, description: "contains the marker" },
    ],
    maxRenderedBytes: 4_096,
  } as const],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "回复是否含确定性 marker？" }),
  },
});

export default defineEval({
  description: "配置 Judge 后，一次质量检查发布一个可读的 measurement artifact",
  judge: judging,
  async test(t) {
    const turn = await t.send("assertion/judge");
    await turn.succeeded().orStop();
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
