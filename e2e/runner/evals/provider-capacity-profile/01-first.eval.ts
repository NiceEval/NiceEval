import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "first profile-bound Attempt occupies the available reservation",
  async test(t) {
    const turn = await t.send("run the first profile-capacity Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
