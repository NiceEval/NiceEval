import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "the second capacity-one Docker sandbox runs only after the first releases",
  async test(t) {
    const turn = await t.send("run the second capacity-one sandbox");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
