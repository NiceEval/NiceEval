import { defineEval, defineJudge } from "niceeval";

const judging = defineJudge({
  name: "marker-unavailable",
  rubric: "回复是否含确定性 marker？",
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
    turn.judge({ input: turn.input, reply: turn.message }, judging)
      .gate(1)
      .label("Judge marker");
  },
});
