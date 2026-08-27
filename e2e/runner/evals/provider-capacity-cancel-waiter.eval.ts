import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "a granted profile reservation remains queued until runner permits return",
  async test(t) {
    const turn = await t.send("run the granted provider-capacity waiter");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
