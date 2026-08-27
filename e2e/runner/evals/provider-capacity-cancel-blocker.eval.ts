import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "an independent Attempt holds the runner permit during waiter cancellation",
  async test(t) {
    const turn = await t.send("hold the runner permit for the provider-capacity waiter");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
