import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "runner accept reanchor target",
  async test(t) {
    const turn = await t.send("accept");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("runner-live-ok"));
  },
});
