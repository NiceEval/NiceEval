import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "the first capacity-one Docker sandbox remains running while the second waits",
  async test(t) {
    const turn = await t.send("run the first capacity-one sandbox");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("provider-capacity-fixture-ok"));
  },
});
