import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner accept reanchor secondary target",
  async test(t) {
    const turn = await t.send("accept secondary");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-fixture-ok"));
  },
});
