import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner carry alpha",
  async test(t) {
    const turn = await t.send("alpha");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-fixture-ok"));
  },
});
