import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner generic timing",
  async test(t) {
    const turn = await t.send("timing");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-timing-ok"));
  },
});
