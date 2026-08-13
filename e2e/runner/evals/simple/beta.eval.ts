import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner carry beta",
  async test(t) {
    const turn = await t.send("beta");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-live-ok"));
  },
});
