import { defineEval } from "niceeval";
import { closedQA, type JudgeMaterial } from "niceeval/expect";

export default defineEval({
  description:
    "声明 Judge capability 但未配置模型时，Judge Assertion 以 unavailable 使 Attempt errored，且不发网络请求",
  judge: true,
  async test(t) {
    const turn = await t.send("assertion/judge");
    turn.succeeded();

    // No Judge model is configured in niceeval.config.ts. This Assertion must
    // take the documented zero-network unavailable path.
    const material: JudgeMaterial = { input: turn.input, output: turn.message };
    turn.check(material, closedQA("回复是否含确定性 marker？").atLeast(1))
      .gate()
      .label("Judge marker");
  },
});
