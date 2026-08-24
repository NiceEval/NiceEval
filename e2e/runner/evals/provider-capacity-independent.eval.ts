import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "an unrelated Provider can create its Sandbox while profile capacity is occupied",
  async test(t) {
    const turn = await t.send("run the Provider-independent Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
