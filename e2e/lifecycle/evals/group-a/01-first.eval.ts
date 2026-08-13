import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "create Group A state before the reset boundary",
  async test(t) {
    const turn = await t.send("run Group A first member");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("group-a:first-complete"));
  },
});
