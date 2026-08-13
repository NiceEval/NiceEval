import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "observe Group A state after the reset boundary",
  async test(t) {
    const turn = await t.send("run Group A second member");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("group-a:second-complete"));
  },
});
