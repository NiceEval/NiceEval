import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "create Group B state before the reset boundary",
  async test(t) {
    const turn = await t.send("run Group B first member");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("group-b:first-complete"));
  },
});
