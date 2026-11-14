import { defineEval } from "niceeval";
import { defineJudge } from "niceeval/expect";

const judging = defineJudge({ rubric: "回复是否含确定性 marker？" });

export default defineEval({
  description: "未配置 Judge 模型时，Judge Assertion 以 unavailable 使 Attempt errored，且不发网络请求",
  async test(t) {
    const turn = await t.send("assertion/judge");
    turn.succeeded();

    // No Judge model is configured in niceeval.config.ts. This Assertion must
    // take the documented zero-network unavailable path.
    turn.judge({ input: turn.input, reply: turn.reply }, judging).gate(1).label("Judge marker");
  },
});
