import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "publish one Attempt before the next slot is interrupted",
  async test(t) {
    const turn = await t.send("publish this Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("run-journey-attempt-published"));
  },
});
