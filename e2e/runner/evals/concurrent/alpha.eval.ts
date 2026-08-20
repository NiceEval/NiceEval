import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner concurrent alpha",
  async test(t) {
    const turn = await t.send("concurrent alpha");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-fixture-ok"));
  },
});
