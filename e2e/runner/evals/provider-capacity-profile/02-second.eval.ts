import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "second profile-bound Attempt waits for the available reservation",
  async test(t) {
    const turn = await t.send("run the second profile-capacity Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
